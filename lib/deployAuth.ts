// Who may deploy to which slug through /api/deploy-site.
//
// Before this, /api/deploy-site took { siteId, html, deployedUrl } from anyone and deployed
// the HTML to that slug's Vercel project (and, for an app site, rewrote its stored copy).
// Slugs are public (they are the site URL), so anyone could replace any customer's site.
//
// The target is always derived here, never taken from the body as is:
// - slugify(body.siteId) is the requested slug. slugify is idempotent, and `target` is used
//   downstream exactly as returned (the gate refuses a non-canonical one).
// - body.deployedUrl is only a hint: its *.vercel.app label is used when it is an
//   app (iOS) slug that the caller owns (or the caller is the admin). An app site renamed
//   on the web keeps its bound slug this way. A hint naming an app slug the caller does not
//   own is refused (401/403); it never falls through to a web deploy on the shop-name slug.
//
// Proof, strongest first:
// - Admin: Supabase bearer whose user is ADMIN_EMAIL (lib/admin/auth.ts). Any slug.
// - App slug (ios_purchases.site_slug): only a Supabase bearer whose user is
//   ios_purchases.user_id. A checkout session never counts for an app slug.
// - Web slug:
//   - a paid, complete aibarber *subscription* Checkout Session for exactly this slug (the
//     first publish after checkout, and the /recover replay), created within
//     CHECKOUT_PROOF_MAX_AGE_MS; or
//   - a valid Supabase bearer, where:
//     - a `sites` row of another account claiming the clean URL or the stamped URL (and
//       none of the caller's) refuses;
//     - a stored copy stamped by the server (deployedUrl: the site is published) needs the
//       caller's own `sites` row claiming it;
//     - no stamp and an existing Vercel project: allowed (the old rule);
//     - no stamp and no Vercel project (a brand-new site) needs checkout or the admin, except
//       a rename: the caller is the only account claiming the deployedUrl hint, and that hint
//       is an existing project.
//   NOTE: `sites` rows are user-writable under RLS, so a claim is not proof of ownership.
//   The server-only owner list (013 site_owners, lib/siteOwners.ts) now decides first: a web
//   site with an owner row is the owner's only (403 for anyone else; an unclaimed row is claimed
//   by a confirmed, exactly matching checkout email). Only a site with no owner yet falls back
//   to the `sites`-claim rule above.
//
// Every lookup fails closed (503): an outage must not turn into an unauthenticated deploy.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ADMIN_EMAIL } from './admin/auth.js';
import { readPendingSite, slugify } from './publishSite.js';
import { vercelProjectExists } from './ios/slug.js';
import { supabasePurchases, type PurchaseRow } from './ios/purchases.js';
import { withTimeout } from './ios/timeout.js';
import { normEmail, supabaseSiteOwners, webOwnerDecision, type SiteOwnerStore } from './siteOwners.js';
import { isPayFirstPlan } from './payFirst.js';

export const CHECKOUT_PROOF_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const LOOKUP_TIMEOUT_MS = 5000;

export interface DeployUser {
  id: string;
  email: string | null;
  /** auth.users.email_confirmed_at is set (owner-list email claims need it). */
  emailConfirmed?: boolean;
}

export interface CheckoutProof {
  /** payment_status === 'paid'. */
  paid: boolean;
  /** Session status ('complete', 'open', 'expired'); null when absent. */
  status: string | null;
  /** 'subscription' for every site checkout; 'payment' for a domain purchase. */
  mode: string | null;
  /** metadata.siteId, else client_reference_id. */
  siteId: string | null;
  /** metadata.app; must be 'aibarber'. */
  app: string | null;
  /** Unix seconds. */
  created: number;
  /** customer_details.email, else customer_email: who paid (the owner list's checkout email). */
  email?: string | null;
  /** metadata.plan ('/custom-15' pay-first plans may name their real slug at the details step). */
  plan?: string | null;
}

export interface DeployAuthDeps {
  /** The token's user; null when the token is not valid. Throws on an outage. */
  userOf(token: string): Promise<DeployUser | null>;
  /** The iOS purchase bound to this slug, or null. Throws on an outage. */
  findBySlug(slug: string): Promise<PurchaseRow | null>;
  /** The Checkout Session, or null when Stripe does not know it. Throws on an outage. */
  checkoutSession(sessionId: string): Promise<CheckoutProof | null>;
  /** User ids of `sites` rows whose deployed_url is one of these origins (with or without a trailing slash). Throws on an outage. */
  webClaimants(urls: string[]): Promise<string[]>;
  /** The server-written deployedUrl stamp on pending-sites/{slug}.json, or null. Throws on an outage. */
  storedStamp(slug: string): Promise<string | null>;
  /** Does a Vercel project with this name exist? Throws on an outage. */
  projectExists(slug: string): Promise<boolean>;
  /** The web site owner list (013). Absent: the interim rule only. */
  siteOwners?: SiteOwnerStore;
  now(): number;
  lookupTimeoutMs?: number;
}

export interface DeployAuthInput {
  siteId: unknown;
  deployedUrl?: unknown;
  authorization?: unknown;
  checkoutSessionId?: unknown;
}

export type DeployActor = 'admin' | 'app-owner' | 'web-user' | 'checkout';

// Flat, not a discriminated union: strictNullChecks is off in this repo.
export interface DeployAuthResult {
  ok: boolean;
  /** Set when !ok. */
  status?: 400 | 401 | 403 | 503;
  error?: string;
  /** Set when ok: the slug to deploy to. */
  target?: string;
  /** Set when ok and the target is an app site. */
  row?: PurchaseRow | null;
  actor?: DeployActor;
  userId?: string | null;
  /** The signed-in caller, when there is one (the checkout deploy records the owner with it). */
  user?: DeployUser | null;
  /**
   * Set for actor 'checkout': the session that authorised it, who paid, and whether the slug was
   * NOT live before this deploy (no server stamp, no Vercel project; read before the deploy).
   * Only a first publish records an owner: a checkout naming an already-live site must never
   * hand it to whoever paid (they could claim it and lock the real owner out).
   */
  checkout?: { sessionId: string; email: string | null; firstPublish: boolean; renamedFrom?: string };
}

const VERCEL_APP = '.vercel.app';
const SESSION_ID = /^cs_(test|live)_[A-Za-z0-9]{10,200}$/;

/** First host label of a *.vercel.app URL, slugified, or null. */
export function vercelAppLabel(deployedUrl: unknown): string | null {
  if (typeof deployedUrl !== 'string' || !deployedUrl) return null;
  try {
    const host = new URL(deployedUrl).hostname.toLowerCase();
    if (!host.endsWith(VERCEL_APP)) return null;
    const label = host.split('.')[0];
    return label && /^[a-z0-9-]+$/.test(label) && slugify(label) === label ? label : null;
  } catch {
    return null;
  }
}

/** https://{host} of a URL, or null. The form `sites.deployed_url` is matched against. */
export function originOf(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && u.hostname ? `https://${u.hostname.toLowerCase()}` : null;
  } catch {
    return null;
  }
}

export function bearerOf(authorization: unknown): string {
  const header = Array.isArray(authorization) ? authorization[0] : authorization;
  return (typeof header === 'string' ? header : '').replace(/^Bearer\s+/i, '').trim();
}

const deny = (status: 401 | 403, error: string): DeployAuthResult => ({ ok: false, status, error });
const unavailable: DeployAuthResult = { ok: false, status: 503, error: 'temporarily-unavailable' };

export async function authorizeDeploy(input: DeployAuthInput, deps: DeployAuthDeps): Promise<DeployAuthResult> {
  const shopSlug = slugify(String(input.siteId ?? ''));
  if (!shopSlug) return { ok: false, status: 400, error: 'bad-request' };
  const label = vercelAppLabel(input.deployedUrl);
  const ms = deps.lookupTimeoutMs ?? LOOKUP_TIMEOUT_MS;
  const token = bearerOf(input.authorization);

  let user: DeployUser | null = null;
  let shopRow: PurchaseRow | null = null;
  let labelRow: PurchaseRow | null = null;
  try {
    [user, shopRow, labelRow] = await withTimeout(
      Promise.all([
        token ? deps.userOf(token) : Promise.resolve(null),
        deps.findBySlug(shopSlug),
        label && label !== shopSlug ? deps.findBySlug(label) : Promise.resolve(null),
      ]),
      ms,
      'deploy auth lookup',
    );
  } catch (e: any) {
    console.error(`[Deploy Site] auth lookup failed for ${shopSlug} (refusing):`, e?.message || e);
    return unavailable;
  }

  const isAdmin = !!user && (user.email || '').toLowerCase() === ADMIN_EMAIL;
  const owns = (row: PurchaseRow | null) => !!row && !!user && !!row.user_id && row.user_id === user.id;

  // The deployedUrl hint: only to an app slug the caller may deploy to. A hint naming someone
  // else's app site is refused: web customers never send one, and falling through would
  // deploy an unlinked app owner's edit to an unrelated web project on the shop-name slug.
  if (labelRow && (isAdmin || owns(labelRow))) {
    return { ok: true, target: label!, row: labelRow, actor: isAdmin ? 'admin' : 'app-owner', userId: user!.id };
  }
  if (labelRow) {
    console.warn(`[Deploy Site] ${shopSlug}: deployedUrl hint ${label} is an app site the caller does not own; refusing`);
    return user ? deny(403, 'not-authorized') : deny(401, 'sign-in-required');
  }

  if (isAdmin) return { ok: true, target: shopSlug, row: shopRow, actor: 'admin', userId: user!.id };

  if (shopRow) {
    // App site: the Apple-bound owner only, by Supabase account. Never a checkout session.
    if (owns(shopRow)) return { ok: true, target: shopSlug, row: shopRow, actor: 'app-owner', userId: user!.id };
    console.warn(`[Deploy Site] ${shopSlug}: app site, caller is not its owner (${user ? user.id : 'no session'}); refusing`);
    return user ? deny(403, 'not-authorized') : deny(401, 'sign-in-required');
  }

  // Web slug. A paid checkout for exactly this slug (first publish, /recover replay).
  const sessionId = typeof input.checkoutSessionId === 'string' ? input.checkoutSessionId.trim() : '';
  if (sessionId && SESSION_ID.test(sessionId)) {
    let proof: CheckoutProof | null;
    try {
      proof = await withTimeout(deps.checkoutSession(sessionId), ms, 'checkout session lookup');
    } catch (e: any) {
      console.error(`[Deploy Site] ${shopSlug}: checkout lookup failed (refusing):`, e?.message || e);
      return unavailable;
    }
    const fresh = !!proof && deps.now() - proof.created * 1000 <= CHECKOUT_PROOF_MAX_AGE_MS;
    // Only a site checkout: a domain purchase (mode 'payment', no metadata.app, client-priced)
    // or any other app's session never counts.
    const valid = !!proof && proof.paid && proof.status === 'complete' && proof.mode === 'subscription' && fresh && proof.app === 'aibarber';
    const proofSlug = slugify(proof?.siteId || '');
    // /custom-15 pay-first (re-review R1): the checkout names a unique placeholder slug, and the
    // details step after payment picks the real one. That session may publish ONE brand-new slug.
    const payFirstRename = valid && proofSlug !== shopSlug && isPayFirstPlan(proof!.plan);
    if (valid && (proofSlug === shopSlug || payFirstRename)) {
      let firstPublish = false;
      try {
        const [stamp, exists] = await withTimeout(Promise.all([deps.storedStamp(shopSlug), deps.projectExists(shopSlug)]), ms, 'first-publish check');
        firstPublish = !stamp && !exists;
      } catch (e: any) {
        console.warn(`[Deploy Site] ${shopSlug}: first-publish check failed; no owner will be recorded:`, e?.message || e);
      }
      // Review fix round 1 (finding 2): a checkout is never proof against the owner list. With an
      // owner row (claimed or not), only the session that created it still counts (the buyer's own
      // /recover replay), or (R2) a checkout paid with the owner's email (re-checkout after a
      // lapse); any other session falls through to the signed-in rules below.
      const liveRename = 'pay-first rename to a slug that is already live';
      let blocked: string | null = payFirstRename && !firstPublish && !deps.siteOwners ? liveRename : null;
      if (deps.siteOwners && !blocked) {
        try {
          const row = await withTimeout(deps.siteOwners.get(shopSlug), ms, 'site owner lookup');
          const paidAs = normEmail(proof!.email);
          const ownersEmail = !!row && !!paidAs && (paidAs === row.owner_email || paidAs === row.claim_email);
          if (row && row.checkout_session_id !== sessionId && !ownersEmail) blocked = 'owned site; this checkout is not its owner\'s';
          // A live slug is never a pay-first rename target, except the one this session already
          // published (its owner row carries this session: the /recover replay).
          if (!blocked && payFirstRename && !firstPublish && row?.checkout_session_id !== sessionId) blocked = liveRename;
          if (!blocked && payFirstRename && deps.siteOwners.slugsForSession) {
            // One site per pay-first purchase: the session may only ever bind its placeholder and this slug.
            const bound = await withTimeout(deps.siteOwners.slugsForSession(sessionId), ms, 'session owner lookup');
            if (bound.some((s) => s !== proofSlug && s !== shopSlug)) blocked = 'this pay-first checkout already published another site';
          }
        } catch (e: any) {
          console.error(`[Deploy Site] ${shopSlug}: owner lookup failed (refusing):`, e?.message || e);
          return unavailable;
        }
      }
      if (!blocked) {
        if (payFirstRename) console.log(`[Deploy Site] ${shopSlug}: pay-first site named at the details step (checkout placeholder ${proofSlug})`);
        return {
          ok: true, target: shopSlug, row: null, actor: 'checkout', userId: user?.id ?? null, user,
          checkout: { sessionId, email: proof!.email ?? null, firstPublish, ...(payFirstRename ? { renamedFrom: proofSlug } : {}) },
        };
      }
      console.warn(`[Deploy Site] ${shopSlug}: checkout ${sessionId} not accepted as proof (${blocked})`);
    } else {
      console.warn(`[Deploy Site] ${shopSlug}: checkout session does not authorise this slug`);
    }
  }

  if (user) return authorizeWebUser(shopSlug, label, user, deps, ms);

  // A checkout that does not match (another slug, unpaid, older than the proof window).
  return sessionId ? deny(403, 'checkout-not-valid') : deny(401, 'sign-in-required');
}

/** A signed-in, non-admin caller on a web slug, with no valid checkout proof. */
async function authorizeWebUser(
  shopSlug: string,
  label: string | null,
  user: DeployUser,
  deps: DeployAuthDeps,
  ms: number,
): Promise<DeployAuthResult> {
  const ok: DeployAuthResult = { ok: true, target: shopSlug, row: null, actor: 'web-user', userId: user.id, user };
  try {
    // The owner list first (013): an owned site is its owner's only; an unowned one (no row, or
    // a row the caller can't claim) keeps the interim rule below.
    if (deps.siteOwners) {
      const verdict = await withTimeout(webOwnerDecision(shopSlug, user, deps.siteOwners, deps.now), ms, 'site owner lookup');
      if (verdict === 'owner') return ok;
      if (verdict === 'not-owner') {
        console.warn(`[Deploy Site] ${shopSlug}: owned by another account (site_owners); refusing ${user.id}`);
        return deny(403, 'not-authorized');
      }
    }
    const rawStamp = await withTimeout(deps.storedStamp(shopSlug), ms, 'stored copy read');
    const stamp = originOf(rawStamp);
    const urls = [`https://${shopSlug}.vercel.app`, ...(stamp ? [stamp] : [])];
    const claimants = await withTimeout(deps.webClaimants([...new Set(urls)]), ms, 'sites claim lookup');
    const mine = claimants.includes(user.id);
    // Review fix round 1 (finding 11): `sites` rows are user-writable, so a co-claim is no proof.
    // With no owner row yet, the caller must be the ONLY account claiming the URL.
    if (claimants.length > 0 && !(mine && claimants.length === 1)) {
      console.warn(`[Deploy Site] ${shopSlug}: ${mine ? 'also ' : ''}claimed by another account; refusing ${user.id}`);
      return deny(403, 'not-authorized');
    }
    // Published (the server stamped the stored copy): only an account that claims it.
    if (rawStamp) {
      if (mine) return ok;
      console.warn(`[Deploy Site] ${shopSlug}: published site no account of the caller claims; refusing ${user.id}`);
      return deny(403, 'not-authorized');
    }
    if (await withTimeout(deps.projectExists(shopSlug), ms, 'vercel project lookup')) return ok;

    // A brand-new Vercel project. Sites are created through checkout (or by the admin); the one
    // signed-in flow that creates one is the editor renaming a shop (the slug follows the shop
    // name). Allowed only when the caller is the only account claiming the old URL (the
    // deployedUrl hint, rebuilt from its parsed label) and that old project exists.
    if (label && label !== shopSlug) {
      const old = `https://${label}.vercel.app`;
      const [oldClaimants, oldExists] = await withTimeout(
        Promise.all([deps.webClaimants([old]), deps.projectExists(label)]),
        ms,
        'rename lookup',
      );
      if (oldExists && oldClaimants.length === 1 && oldClaimants[0] === user.id) {
        console.log(`[Deploy Site] ${shopSlug}: new project for a rename of ${label} by ${user.id}`);
        return ok;
      }
    }
    console.warn(`[Deploy Site] ${shopSlug}: new site without checkout; refusing ${user.id}`);
    return deny(403, 'new-site-needs-checkout');
  } catch (e: any) {
    console.error(`[Deploy Site] ${shopSlug}: web ownership lookup failed (refusing):`, e?.message || e);
    return unavailable;
  }
}

/** Live dependencies: Supabase (service role), Stripe, GCS and Vercel. Clients are created on first use. */
export function liveDeployAuthDeps(): DeployAuthDeps {
  let sb: SupabaseClient | undefined;
  const db = () => (sb ??= createClient(
    (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  ));
  let repo: ReturnType<typeof supabasePurchases> | undefined;
  let owners: SiteOwnerStore | undefined;
  return {
    async userOf(token) {
      const { data, error } = await db().auth.getUser(token);
      if (error) {
        // An invalid or expired token is a 4xx from GoTrue; anything else is an outage.
        const status = (error as any).status;
        if (typeof status === 'number' && status >= 400 && status < 500) return null;
        throw new Error(`auth.getUser failed: ${error.message}`);
      }
      return data?.user
        ? { id: data.user.id, email: data.user.email?.toLowerCase() ?? null, emailConfirmed: !!data.user.email_confirmed_at }
        : null;
    },
    findBySlug: (slug) => (repo ??= supabasePurchases(db())).findBySlug(slug),
    async checkoutSession(sessionId) {
      const key = process.env.STRIPE_SECRET_KEY;
      if (!key) throw new Error('STRIPE_SECRET_KEY not set');
      const resp = await fetch(`https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`, {
        headers: { Authorization: `Bearer ${key}` },
      });
      if (resp.status === 404) return null;
      if (!resp.ok) throw new Error(`Stripe session lookup failed: ${resp.status}`);
      const s: any = await resp.json();
      const siteId =
        (typeof s?.metadata?.siteId === 'string' && s.metadata.siteId) ||
        (typeof s?.client_reference_id === 'string' && s.client_reference_id) ||
        null;
      return {
        paid: s?.payment_status === 'paid',
        status: typeof s?.status === 'string' ? s.status : null,
        mode: typeof s?.mode === 'string' ? s.mode : null,
        siteId,
        app: typeof s?.metadata?.app === 'string' ? s.metadata.app : null,
        created: typeof s?.created === 'number' ? s.created : 0,
        plan: typeof s?.metadata?.plan === 'string' ? s.metadata.plan : null,
        email: (typeof s?.customer_details?.email === 'string' && s.customer_details.email) ||
          (typeof s?.customer_email === 'string' && s.customer_email) || null,
      };
    },
    async webClaimants(urls) {
      const forms = urls.flatMap((u) => [u, `${u}/`]);
      const { data, error } = await db().from('sites').select('user_id').in('deployed_url', forms);
      if (error) throw new Error(`sites claim lookup failed: ${error.message}`);
      return [...new Set((data || []).map((r: any) => r.user_id).filter((u: unknown): u is string => typeof u === 'string'))];
    },
    storedStamp: async (slug) => (await readPendingSite(slug))?.deployedUrl || null,
    projectExists: (slug) => vercelProjectExists(slug),
    get siteOwners() { return (owners ??= supabaseSiteOwners(db())); },
    now: () => Date.now(),
  };
}
