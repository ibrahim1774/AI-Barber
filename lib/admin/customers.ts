// Admin "Customers" lookup: one row per (project, user) joined from every place a customer can live.
// Pure join logic: the rows are fetched elsewhere (lib/admin/customersLive.ts) and handed in as
// CustomerSources, so every rule here is testable with plain objects. Never throws on missing data.
//
// Secrets: rows are built field by field. Nothing from a source row is copied wholesale, so a
// password, token or key that happens to sit next to a field we read can never reach the payload.
import { familyOf, isCustomDesignProduct } from './families.js';
import { MANUAL_IDENTITIES } from './manualIdentities.js';
import { normalizePhoneE164 } from '../phone/e164.js';

export type SourceState = 'ok' | 'skipped' | 'error';
export type SourceStatus = Record<string, SourceState>;

export type CustomerFamily =
  | 'primebarber-web' | 'aibarber-legacy' | 'ios' | 'custom-design' | 'primehub-pro' | 'primehub-legacy' | 'account-only';
export type PhoneSource = 'contact' | 'auth' | 'metadata' | 'site' | 'legacy-site' | 'profile' | 'stripe' | 'manual' | null;
export type AuthKind = 'password' | 'google' | 'otp' | 'none';

export interface AuthUserLite {
  id: string;
  email?: string | null;
  phone?: string | null;
  created_at?: string | null;
  last_sign_in_at?: string | null;
  user_metadata?: Record<string, any> | null;
  app_metadata?: Record<string, any> | null;
  identities?: Array<{ provider?: string; identity_data?: Record<string, any> | null }> | null;
}

export interface StripeCustomerLite { id: string; email?: string | null; phone?: string | null; name?: string | null }

export interface StripePool {
  customers: StripeCustomerLite[];
  /** Subscriptions as Stripe returns them with expand[]=data.plan.product (customer may be an id or an object). */
  subs: any[];
}

export interface MainData {
  users: AuthUserLite[];
  webEntitlements: any[];
  webCustomers: any[];
  webSites: any[];
  siteOwners: any[];
  iosPurchases: any[];
  iosDomains: any[];
  legacySites: any[];
  usersProfile: any[];
  contacts: any[];
}

export interface ProData {
  users: AuthUserLite[];
  sites: any[];
  entitlements: any[];
  customers: any[];
  domains: any[];
  contacts: any[];
}

export interface CustomerSources {
  /** ms epoch; decides whether an iOS purchase is still running. */
  now: number;
  main: MainData;
  stripe: StripePool;
  /** Absent when the PrimeHub Pro project is not configured (status.pro = 'skipped'). */
  pro?: ProData;
  /** A second Stripe account for Pro, only when its key differs from the main one. */
  proStripe?: StripePool;
  /** The address to show for a slug (lib/ios/siteUrlFor.stampedSiteUrl). May be slow: cached per slug, 8 at a time. */
  siteUrlOf(slug: string): Promise<string | null>;
  status: SourceStatus;
}

export interface AlsoPlan { source: 'web' | 'ios' | 'legacy' | 'pro'; plan: string; interval: string | null; status: string }

export interface CustomerRow {
  key: string;
  family: CustomerFamily;
  userId: string | null;
  project: 'main' | 'pro';
  contactEmail: string | null;
  stripeEmail: string | null;
  accountEmail: string | null;
  signupEmail: string | null;
  siteUrl: string | null;
  siteSlug: string | null;
  customDomain: string | null;
  phone: string | null;
  phoneSource: PhoneSource;
  plan: string | null;
  interval: string | null;
  status: string | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  stripeCustomerUrl: string | null;
  signedUp: string | null;
  lastSignIn: string | null;
  authKind: AuthKind;
  flags: string[];
  alsoPlans: AlsoPlan[];
}

const ACTIVE = new Set(['active', 'trialing', 'past_due']);
const DOMAIN_OK = new Set(['live', 'attached', 'manual_live']);
const SITE_CONCURRENCY = 8;

const lc = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim().toLowerCase() : null);
const txt = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const iso = (v: unknown): string | null => {
  if (typeof v !== 'string' || !v) return null;
  return v;
};
const ms = (v: unknown): number => { const t = typeof v === 'string' ? Date.parse(v) : NaN; return Number.isFinite(t) ? t : 0; };

function group<T>(rows: T[], keyOf: (r: T) => unknown): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const r of rows || []) {
    const k = keyOf(r);
    if (typeof k !== 'string' || !k) continue;
    const a = m.get(k);
    if (a) a.push(r); else m.set(k, [r]);
  }
  return m;
}

/** Normalised when it is a real number, otherwise the text as it was typed (manual entries carry notes). */
function showPhone(raw: string): string {
  const n = normalizePhoneE164(raw);
  if (n.ok) return n.e164;
  // Supabase stores auth phones without the '+': 447911123456
  if (/^\d{11,15}$/.test(raw.trim())) {
    const p = normalizePhoneE164('+' + raw.trim());
    if (p.ok) return p.e164;
  }
  return raw;
}

function authKindOf(u: AuthUserLite | undefined, otpOnly = false): AuthKind {
  if (!u) return 'none';
  const providers = new Set<string>();
  for (const i of u.identities || []) if (i?.provider) providers.add(i.provider);
  const ap = u.app_metadata?.providers;
  if (Array.isArray(ap)) for (const p of ap) if (typeof p === 'string') providers.add(p);
  if (typeof u.app_metadata?.provider === 'string') providers.add(u.app_metadata.provider);
  if (providers.has('email')) return otpOnly ? 'otp' : 'password';
  if (providers.has('google')) return 'google';
  if (providers.has('phone')) return 'otp';
  return providers.size ? 'otp' : 'none';
}

function signupEmailOf(u: AuthUserLite | undefined, claimEmail: string | null): string | null {
  const fromIdentity = lc(u?.identities?.[0]?.identity_data?.email);
  return fromIdentity ?? lc(u?.user_metadata?.email) ?? claimEmail;
}

interface Candidate {
  source: AlsoPlan['source'];
  plan: string;
  interval: string | null;
  status: string;
  active: boolean;
  test: boolean;
  customerId: string | null;
  subscriptionId: string | null;
  family: CustomerFamily;
  createdAt: number;
}

function candidateRank(c: Candidate, order: AlsoPlan['source'][]): number[] {
  return [c.test ? 1 : 0, c.active ? 0 : 1, order.indexOf(c.source), -c.createdAt];
}

function pickPrimary(cands: Candidate[], order: AlsoPlan['source'][]): { primary: Candidate | null; also: AlsoPlan[] } {
  if (!cands.length) return { primary: null, also: [] };
  // Source priority applies inside the same liveness class: a live active iOS plan beats a canceled web one.
  const sorted = [...cands].sort((a, b) => {
    const ra = candidateRank(a, order), rb = candidateRank(b, order);
    for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
    return 0;
  });
  const primary = sorted[0];
  const also = sorted.slice(1).map((c) => ({ source: c.source, plan: c.plan, interval: c.interval, status: c.status }));
  return { primary, also };
}

/** Run fn over items, at most `limit` at a time. */
async function mapLimit<T>(items: T[], limit: number, fn: (x: T) => Promise<void>): Promise<void> {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const mine = items[i++];
      await fn(mine);
    }
  });
  await Promise.all(workers);
}

const stripeUrl = (id: string | null, test: boolean) => (id ? `https://dashboard.stripe.com/${test ? 'test/' : ''}customers/${id}` : null);

function subCustomer(s: any): StripeCustomerLite | null {
  const c = s?.customer;
  if (c && typeof c === 'object' && typeof c.id === 'string') return { id: c.id, email: c.email, phone: c.phone, name: c.name };
  return null;
}

function subProduct(s: any): string {
  const p = s?.plan?.product;
  return p && typeof p === 'object' && typeof p.name === 'string' ? p.name : 'Unknown product';
}
const subCustomerId = (s: any): string | null => (typeof s?.customer === 'string' ? s.customer : subCustomer(s)?.id ?? null);

function legacyCandidate(s: any): Candidate | null {
  const product = subProduct(s);
  const fam = familyOf(product);
  if (fam === 'other-biz') return null; // other businesses on the same Stripe account
  const family: CustomerFamily = isCustomDesignProduct(product) ? 'custom-design'
    : fam === 'primehub' ? 'primehub-legacy' : 'aibarber-legacy';
  const status = typeof s.status === 'string' ? s.status : 'unknown';
  return {
    source: 'legacy', plan: product, interval: s.plan?.interval ?? null, status,
    active: ACTIVE.has(status), test: s.livemode === false, customerId: subCustomerId(s), subscriptionId: s.id ?? null,
    family, createdAt: typeof s.created === 'number' ? s.created * 1000 : 0,
  };
}

function pool(...ps: Array<StripePool | undefined>) {
  const customers = new Map<string, StripeCustomerLite>();
  const subs: any[] = [];
  const seenSub = new Set<string>();
  for (const p of ps) {
    if (!p) continue;
    for (const c of p.customers || []) if (c?.id) customers.set(c.id, { ...customers.get(c.id), ...c });
    for (const s of p.subs || []) {
      if (!s?.id || seenSub.has(s.id)) continue;
      seenSub.add(s.id);
      subs.push(s);
      const c = subCustomer(s);
      if (c && !customers.has(c.id)) customers.set(c.id, c);
    }
  }
  return { customers, subs };
}

export async function buildCustomerRows(src: CustomerSources): Promise<CustomerRow[]> {
  const m = src.main;
  const sp = pool(src.stripe, src.proStripe);
  const subsByCustomer = group(sp.subs, subCustomerId);

  // Subscription ids that an entitlement table already owns: the legacy join must not list them twice.
  const owned = new Set<string>();
  for (const e of m.webEntitlements || []) if (e?.stripe_subscription_id) owned.add(e.stripe_subscription_id);
  for (const e of src.pro?.entitlements || []) if (e?.stripe_subscription_id) owned.add(e.stripe_subscription_id);

  // Stripe customer -> user, from explicit links first (checkout bound them), email second (legacy join).
  const custToUser = new Map<string, string>();
  const link = (cus: unknown, uid: unknown) => { if (typeof cus === 'string' && cus && typeof uid === 'string' && uid && !custToUser.has(cus)) custToUser.set(cus, uid); };
  for (const e of m.webEntitlements || []) link(e.stripe_customer_id, e.user_id);
  for (const c of m.webCustomers || []) link(c.stripe_customer_id, c.user_id);
  for (const p of m.usersProfile || []) link(p.stripe_customer_id, p.id ?? p.user_id);
  // Pro's Stripe customers belong to the Pro project: they never attach to a main account by email
  // and never become Stripe-only rows.
  const proCust = new Set<string>();
  for (const e of src.pro?.entitlements || []) if (e?.stripe_customer_id) proCust.add(e.stripe_customer_id);
  for (const c of src.pro?.customers || []) if (c?.stripe_customer_id) proCust.add(c.stripe_customer_id);
  const userByEmail = new Map<string, string>();
  for (const u of m.users || []) { const e = lc(u.email); if (e && !userByEmail.has(e)) userByEmail.set(e, u.id); }
  for (const c of sp.customers.values()) {
    if (custToUser.has(c.id) || proCust.has(c.id)) continue;
    const uid = userByEmail.get(lc(c.email) ?? '');
    if (uid) custToUser.set(c.id, uid);
  }
  const custsByUser = new Map<string, StripeCustomerLite[]>();
  for (const [cid, uid] of custToUser) {
    const c = sp.customers.get(cid) ?? { id: cid };
    const a = custsByUser.get(uid);
    if (a) a.push(c); else custsByUser.set(uid, [c]);
  }

  const webEntByUser = group(m.webEntitlements, (r) => r.user_id);
  const webSitesByUser = group(m.webSites, (r) => r.user_id);
  const ownersByUser = group(m.siteOwners, (r) => r.user_id);
  const iosByUser = group(m.iosPurchases, (r) => r.user_id);
  const legacySitesByUser = group(m.legacySites, (r) => r.user_id);
  const profileByUser = new Map((m.usersProfile || []).map((p) => [p.id ?? p.user_id, p] as const));
  const contactByUser = new Map((m.contacts || []).map((c) => [c.user_id, c] as const));
  const domainsBySlug = group((m.iosDomains || []).filter((d) => DOMAIN_OK.has(d.state)), (d) => d.site_slug);

  const siteCache = new Map<string, Promise<string | null>>();
  const siteUrl = (slug: string) => {
    let p = siteCache.get(slug);
    if (!p) { p = Promise.resolve().then(() => src.siteUrlOf(slug)).catch(() => null); siteCache.set(slug, p); }
    return p;
  };

  interface Draft { row: CustomerRow; slugs: { web: string[]; ios: string[] }; deployedUrl: string | null; manualSite: string | null }
  const drafts: Draft[] = [];

  // ---- main project: one row per auth user -------------------------------------------------------
  for (const u of m.users || []) {
    const uid = u.id;
    const account = lc(u.email);
    const ents = webEntByUser.get(uid) ?? [];
    const iosRows = iosByUser.get(uid) ?? [];
    const custs = custsByUser.get(uid) ?? [];
    const cands: Candidate[] = [];
    for (const e of ents) {
      const status = txt(e.status) ?? 'unknown';
      cands.push({ source: 'web', plan: txt(e.tier) ?? 'web', interval: txt(e.billing_interval), status, active: ACTIVE.has(status),
        test: e.environment === 'test', customerId: txt(e.stripe_customer_id), subscriptionId: txt(e.stripe_subscription_id), family: 'primebarber-web', createdAt: ms(e.created_at) });
    }
    for (const p of iosRows) {
      const revoked = !!p.revoked_at;
      const exp = ms(p.expires_at);
      const status = revoked ? 'revoked' : exp && exp < src.now ? 'expired' : 'active';
      cands.push({ source: 'ios', plan: txt(p.product_id) ?? 'ios', interval: null, status, active: status === 'active',
        test: p.environment === 'Sandbox', customerId: null, subscriptionId: txt(p.original_transaction_id), family: 'ios', createdAt: ms(p.created_at) });
    }
    for (const c of custs) {
      for (const s of subsByCustomer.get(c.id) ?? []) {
        if (owned.has(s.id)) continue;
        const cand = legacyCandidate(s);
        if (cand) cands.push(cand);
      }
    }
    const { primary, also } = pickPrimary(cands, ['web', 'ios', 'legacy', 'pro']);
    const legacySites = legacySitesByUser.get(uid) ?? [];
    const flags: string[] = [];
    if (primary?.test) flags.push('test');

    const stripeCust = (primary?.customerId && sp.customers.get(primary.customerId)) || custs[0] || null;
    const owners = ownersByUser.get(uid) ?? [];
    const claim = lc(owners.find((o) => o.claim_email)?.claim_email);
    const stripeEmail = lc(stripeCust?.email);

    // phone
    const contact = contactByUser.get(uid);
    const meta = u.user_metadata || {};
    const webSites = (webSitesByUser.get(uid) ?? []).filter((s) => !s.removed_at);
    const sitePhone = webSites.find((s) => txt(s.contact_phone));
    const legacyPhone = legacySites.find((s) => txt(s.phone));
    const profile = profileByUser.get(uid);
    const manual = MANUAL_IDENTITIES[stripeEmail ?? ''] ?? MANUAL_IDENTITIES[account ?? ''];
    const phones: Array<[PhoneSource, string | null]> = [
      ['contact', txt(contact?.phone_e164)],
      ['auth', txt(u.phone)],
      ['metadata', txt(meta.phone) ?? txt(meta.phone_number)],
      ['site', txt(sitePhone?.contact_phone)],
      ['legacy-site', txt(legacyPhone?.phone)],
      ['profile', txt(profile?.phone)],
      ['stripe', txt(stripeCust?.phone)],
      ['manual', txt(manual?.phone)],
    ];
    const hit = phones.find(([, v]) => v);

    // slugs
    const webSlugs = new Set<string>();
    for (const s of webSites) if (s.slug) webSlugs.add(s.slug);
    if (!webSites.length) for (const e of ents) if (e.site_slug) webSlugs.add(e.site_slug);
    // the primary entitlement's slug first
    const primarySlug = ents.find((e) => e.stripe_subscription_id === primary?.subscriptionId)?.site_slug;
    const webOrdered = [...webSlugs].sort((a, b) => Number(b === primarySlug) - Number(a === primarySlug));
    const iosSlugs = iosRows.map((p) => p.site_slug).filter((x): x is string => typeof x === 'string' && !!x);

    let family: CustomerFamily = primary?.family ?? 'account-only';
    if (!primary && (webSites.length || iosSlugs.length)) flags.push('site-no-plan');

    // custom domain
    let customDomain: string | null = null;
    for (const slug of [...webOrdered, ...iosSlugs]) {
      const d = (domainsBySlug.get(slug) ?? [])[0];
      if (d?.domain) { customDomain = String(d.domain).toLowerCase(); break; }
    }
    if (!customDomain) customDomain = lc(legacySites.find((s) => s.custom_domain)?.custom_domain);

    const row: CustomerRow = {
      key: `main:${uid}`,
      family,
      userId: uid,
      project: 'main',
      contactEmail: stripeEmail ?? account,
      stripeEmail,
      accountEmail: account,
      signupEmail: signupEmailOf(u, claim),
      siteUrl: null,
      siteSlug: webOrdered[0] ?? iosSlugs[0] ?? null,
      customDomain,
      phone: hit ? showPhone(hit[1]!) : null,
      phoneSource: hit ? hit[0] : null,
      plan: primary?.plan ?? null,
      interval: primary?.interval ?? null,
      status: primary?.status ?? null,
      stripeCustomerId: primary?.customerId ?? stripeCust?.id ?? null,
      stripeSubscriptionId: primary && primary.source !== 'ios' ? primary.subscriptionId : null,
      stripeCustomerUrl: null,
      signedUp: iso(u.created_at),
      lastSignIn: iso(u.last_sign_in_at),
      authKind: authKindOf(u),
      flags,
      alsoPlans: also,
    };
    row.stripeCustomerUrl = stripeUrl(row.stripeCustomerId, !!primary?.test);
    drafts.push({
      row, slugs: { web: webOrdered, ios: iosSlugs },
      deployedUrl: txt(legacySites.find((s) => txt(s.deployed_url))?.deployed_url),
      manualSite: txt(manual?.site),
    });
  }

  // ---- Stripe-only customers: paid, but no account anywhere ---------------------------------------
  for (const c of sp.customers.values()) {
    if (custToUser.has(c.id) || proCust.has(c.id)) continue;
    const cands: Candidate[] = [];
    for (const s of subsByCustomer.get(c.id) ?? []) {
      if (owned.has(s.id)) continue;
      const cand = legacyCandidate(s);
      if (cand) cands.push(cand);
    }
    if (!cands.length) continue; // no subscription: an abandoned checkout, not a customer
    const { primary, also } = pickPrimary(cands, ['legacy']);
    const email = lc(c.email);
    const manual = MANUAL_IDENTITIES[email ?? ''];
    const ph = txt(c.phone) ?? txt(manual?.phone);
    const flags = ['no-account'];
    if (primary?.test) flags.push('test');
    const row: CustomerRow = {
      key: `main:stripe:${c.id}`, family: primary!.family, userId: null, project: 'main',
      contactEmail: email, stripeEmail: email, accountEmail: null, signupEmail: null,
      siteUrl: null, siteSlug: null, customDomain: null,
      phone: ph ? showPhone(ph) : null, phoneSource: txt(c.phone) ? 'stripe' : manual?.phone ? 'manual' : null,
      plan: primary!.plan, interval: primary!.interval, status: primary!.status,
      stripeCustomerId: c.id, stripeSubscriptionId: primary!.subscriptionId, stripeCustomerUrl: stripeUrl(c.id, !!primary!.test),
      signedUp: null, lastSignIn: null, authKind: 'none', flags, alsoPlans: also,
    };
    drafts.push({ row, slugs: { web: [], ios: [] }, deployedUrl: null, manualSite: txt(manual?.site) });
  }

  // ---- PrimeHub Pro ---------------------------------------------------------------------------------
  const proDrafts: Array<{ row: CustomerRow; host: string | null }> = [];
  if (src.pro) {
    const p = src.pro;
    const entsBy = group(p.entitlements, (r) => r.user_id);
    const sitesBy = group(p.sites, (r) => r.user_id);
    const custBy = group(p.customers, (r) => r.user_id);
    const contactBy = new Map((p.contacts || []).map((c) => [c.user_id, c] as const));
    const domainsBySite = group((p.domains || []).filter((d) => d.status === 'live'), (d) => d.site_id);
    for (const u of p.users || []) {
      const uid = u.id;
      const account = lc(u.email);
      const sites = (sitesBy.get(uid) ?? []).filter((s) => s.status !== 'removed' && !s.removed_at);
      const cands: Candidate[] = (entsBy.get(uid) ?? []).map((e) => {
        const status = txt(e.status) ?? 'unknown';
        return { source: 'pro' as const, plan: txt(e.plan) ?? 'pro', interval: txt(e.billing_interval), status, active: ACTIVE.has(status),
          test: e.environment === 'test', customerId: txt(e.stripe_customer_id), subscriptionId: txt(e.stripe_subscription_id), family: 'primehub-pro' as const, createdAt: ms(e.created_at) };
      });
      const { primary, also } = pickPrimary(cands, ['pro']);
      const custId = primary?.customerId ?? txt((custBy.get(uid) ?? [])[0]?.stripe_customer_id);
      const stripeCust = custId ? sp.customers.get(custId) : undefined;
      const stripeEmail = lc(stripeCust?.email);
      const primarySite = sites.find((s) => s.id === (entsBy.get(uid) ?? []).find((e) => e.stripe_subscription_id === primary?.subscriptionId)?.site_id) ?? sites.find((s) => s.paid) ?? sites[0];
      const meta = u.user_metadata || {};
      const contact = contactBy.get(uid);
      const sitePhone = sites.find((s) => txt(s.contact_phone));
      const phones: Array<[PhoneSource, string | null]> = [
        ['contact', txt(contact?.phone_e164)], ['auth', txt(u.phone)], ['metadata', txt(meta.phone) ?? txt(meta.phone_number)],
        ['site', txt(sitePhone?.contact_phone)], ['stripe', txt(stripeCust?.phone)],
      ];
      const hit = phones.find(([, v]) => v);
      const domain = lc(primarySite?.custom_domain) ?? lc((domainsBySite.get(primarySite?.id) ?? [])[0]?.domain);
      const host = txt(primarySite?.published_host) ?? txt(primarySite?.deployed_host) ?? txt(primarySite?.vercel_host);
      const flags: string[] = [];
      if (primary?.test) flags.push('test');
      const row: CustomerRow = {
        key: `pro:${uid}`, family: primary ? 'primehub-pro' : 'account-only', userId: uid, project: 'pro',
        contactEmail: stripeEmail ?? account, stripeEmail, accountEmail: account, signupEmail: signupEmailOf(u, null),
        siteUrl: domain ? `https://${domain}` : host ? `https://${host}` : null,
        siteSlug: txt(primarySite?.slug), customDomain: domain,
        phone: hit ? showPhone(hit[1]!) : null, phoneSource: hit ? hit[0] : null,
        plan: primary?.plan ?? null, interval: primary?.interval ?? null, status: primary?.status ?? null,
        stripeCustomerId: custId, stripeSubscriptionId: primary?.subscriptionId ?? null, stripeCustomerUrl: stripeUrl(custId, !!primary?.test),
        signedUp: iso(u.created_at), lastSignIn: iso(u.last_sign_in_at), authKind: authKindOf(u, true), flags, alsoPlans: also,
      };
      proDrafts.push({ row, host });
    }
  }

  // ---- site addresses: custom domain > web stamp > iOS stamp > legacy deployed_url > manual --------
  const slugsToResolve = new Set<string>();
  for (const d of drafts) {
    if (d.row.customDomain) continue;
    for (const s of d.slugs.web) slugsToResolve.add(s);
    for (const s of d.slugs.ios) slugsToResolve.add(s);
  }
  await mapLimit([...slugsToResolve], SITE_CONCURRENCY, async (slug) => { await siteUrl(slug); });
  for (const d of drafts) {
    const r = d.row;
    if (r.customDomain) { r.siteUrl = `https://${r.customDomain}`; continue; }
    let url: string | null = null;
    for (const slug of d.slugs.web) { url = (await siteUrl(slug)) ?? null; if (url) break; }
    if (!url) for (const slug of d.slugs.ios) { url = (await siteUrl(slug)) ?? null; if (url) break; }
    r.siteUrl = url ?? d.deployedUrl ?? d.manualSite;
  }

  const all = [...drafts.map((d) => d.row), ...proDrafts.map((d) => d.row)];

  // ---- flags that need the whole list --------------------------------------------------------------
  const byEmail = group(all, (r) => r.contactEmail);
  for (const rows of byEmail.values()) if (rows.length > 1) for (const r of rows) r.flags.push('dup-email');
  for (const r of all) {
    if (!r.phone) r.flags.push('no-phone');
    if (r.status && ACTIVE.has(r.status) && !r.siteUrl && r.family !== 'account-only') r.flags.push('paid-no-site');
  }
  return all;
}
