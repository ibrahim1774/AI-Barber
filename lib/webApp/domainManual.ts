// MANUAL fulfilment of the web app's $39/year custom domain (Ibrahim buys and attaches by hand).
// The system never buys a domain for these: a paid, verified subscription parks in a row in the
// machine-inert state `awaiting_setup` (lib/ios/domainsRepo.ts, migration 030), Ibrahim gets ONE
// order email, and three signed links move the row: Mark live / Can't get this name / Mark ended.
//
//   claimManualDomain      the body of claimDomainSubscription for manual subscriptions (metadata fulfil=manual)
//   webStatusBody …        the public status of the two new states (+ the manual end)
//   sign/verifyDomainAction HMAC single-purpose links (GET shows the checks, POST acts)
//   domainActionView / runDomainAction   the link handlers (api/web-app/domain-action.ts)
//   sweepManualDomains     email retries, 24 h unsent alert, 48 h reminder, ended, renewal-due, order-void
//
// Money-path rules: a paid subscription never ends without a row or a refund; every write is a
// conditional UPDATE on the row's own state (so a replay finds the row moved); every mail is keyed
// on the row's alerts_sent marker (written only after a successful send) PLUS a Resend
// Idempotency-Key, so it goes out exactly once. No card data, no secret and no token is ever logged.
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  PayerFailure, alertOnce, projectFor, precheckDomain, ownDetached, refreshFromPayer, settleWebFailure, statusBody, statusWithProbe,
  PAYER_REFRESH_MS, WEB_REFUND_REASONS, type DomainFlowDeps, type DomainStatusBody,
} from '../ios/domainFlow.js';
import { OWNER_REMOVED, type DomainRow } from '../ios/domainsRepo.js';
import { withTimeout } from '../ios/timeout.js';
import {
  finishRefund, recordRefusedPaidSlot, refundedResult, stripePayerStatus, type WebDomainDeps, type WebResult,
} from '../webDomains.js';
import type { Mail } from './emails.js';
import {
  customerLiveEmail, customerOrderedEmail, customerRefundedEmail, endedEmail, orderEmail, orderReminderEmail, orderVoidEmail,
  renewalDueEmail, type OrderFacts, type OrderLinks,
} from './domainEmails.js';

const DAY = 24 * 3600_000;
const HOUR = 3600_000;
export const LINK_TTL_MS = 30 * DAY;
export const ORDER_REMINDER_MS = 48 * HOUR;
export const UNSENT_ALERT_MS = 24 * HOUR;
export const RENEWAL_DUE_MS = 30 * DAY;
const iso = (ms: number) => new Date(ms).toISOString();
const errMsg = (e: unknown) => String((e as any)?.code || (e as Error)?.message || e).slice(0, 200);

export interface ManualDeps {
  /** Send one email (Resend, WEB_APP_EMAIL_FROM). Throws when it was not accepted. `key` is the Resend Idempotency-Key. */
  sendMail(to: string, mail: Mail, key: string): Promise<void>;
  /** DOMAIN_ORDERS_EMAIL (default ibrahim3709@gmail.com). */
  ordersEmail: string;
  /** DOMAIN_ADMIN_LINK_SECRET; empty = no links anywhere (and the action endpoint answers 503). */
  linkSecret: string;
  /** Origin that serves /api/web-app/domain-action. */
  linkBase: string;
  /** The web app's origin (customer mails link to /app/domain). */
  appOrigin: string;
  /** The customer's email and the shop's name, best effort. */
  customerOf(slug: string): Promise<{ email: string | null; shopName: string | null }>;
  /** The site's current public address, best effort. */
  liveUrlOf(slug: string): Promise<string | null>;
  teamSlug?: string | null;
  /** Staging only (test Stripe key, off production): Mark live skips the Vercel / HTTPS checks and says so. */
  verifyStub: boolean;
  /** Stripe subscription, best effort (customer id, test mode for the order mail). */
  getSubscription?(id: string): Promise<any | null>;
  /** The canonical URL the live domain serves (display only on the result page). */
  fetchCanonical?(domain: string): Promise<string | null>;
}

/** What every manual-flow function needs. */
export interface ManualEnv {
  flow: DomainFlowDeps;
  manual: ManualDeps;
  cancelAndRefund(subscriptionId: string): Promise<void>;
  notifySupport?(subject: string, text: string): Promise<void>;
}

/** The subscription asks for manual fulfilment (set only by the web app's checkout and one-click). Unsigned on purpose: forging it can only make an order manual. */
export const isManualSub = (sub: any): boolean => sub?.metadata?.fulfil === 'manual';

// ─── public status ───

/** statusBody plus the manual states: awaiting-setup, a live manual domain, a manually ended one. */
export function webStatusBody(row: DomainRow | null): DomainStatusBody {
  if (!row) return statusBody(null);
  if (row.state === 'awaiting_setup') {
    return {
      domain: row.domain, state: 'awaiting-setup', paidUntil: row.paid_until ? iso(Date.parse(row.paid_until)) : null, autoRenew: row.auto_renew,
      ...(row.simulated ? { sandbox: true as const } : {}),
    };
  }
  if (row.state === 'manual_live') return statusBody({ ...row, state: 'live' });
  if (row.state === 'transferred' && row.transferred_by === 'manual-ended') {
    return { domain: row.domain, state: 'expired', paidUntil: row.paid_until ? iso(Date.parse(row.paid_until)) : null, autoRenew: false, ...(row.simulated ? { sandbox: true as const } : {}) };
  }
  return statusBody(row);
}

/** webStatusBody with the DNS / TLS probe on a live manual domain. */
export async function webStatusWithProbe(row: DomainRow | null, flow: DomainFlowDeps): Promise<DomainStatusBody> {
  if (row?.state === 'manual_live') return statusWithProbe({ ...row, state: 'live' }, flow);
  return webStatusBody(row);
}

// ─── signed links ───

export type DomainAction = 'live' | 'cant' | 'end';
export interface ActionPayload { a: DomainAction; k: string; d: string; s: string; exp: number }
const sigOf = (secret: string, body: string) => createHmac('sha256', secret).update(`v1|domain_action|${body}`).digest('hex');

export function signDomainAction(secret: string, p: ActionPayload): string {
  const body = Buffer.from(JSON.stringify({ a: p.a, k: p.k, d: p.d, s: p.s, exp: p.exp })).toString('base64url');
  return `${body}.${sigOf(secret, body)}`;
}

/** The payload when the MAC is valid and the link has not expired; null otherwise (never says which). */
export function verifyDomainAction(token: unknown, secret: string, now: number): ActionPayload | null {
  if (typeof token !== 'string' || !secret || token.length > 2000) return null;
  const m = /^([A-Za-z0-9_-]+)\.([0-9a-f]{64})$/.exec(token);
  if (!m) return null;
  const want = Buffer.from(sigOf(secret, m[1]), 'hex');
  const got = Buffer.from(m[2], 'hex');
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  let p: any;
  try { p = JSON.parse(Buffer.from(m[1], 'base64url').toString('utf8')); } catch { return null; }
  if (!p || !['live', 'cant', 'end'].includes(p.a) || typeof p.k !== 'string' || typeof p.d !== 'string' || typeof p.s !== 'string' || !Number.isFinite(p.exp)) return null;
  if (now > p.exp) return null;
  return { a: p.a, k: p.k, d: p.d, s: p.s, exp: p.exp };
}

/** A same-origin browser POST: Sec-Fetch-Site same-origin, or an Origin equal to this host. */
export function postAllowed(headers: Record<string, string | string[] | undefined> | undefined): boolean {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const site = one(headers?.['sec-fetch-site']);
  if (site) return site === 'same-origin';
  const origin = one(headers?.origin);
  const host = one(headers?.host);
  return !!origin && !!host && origin === `https://${host}`;
}

function linkFor(action: DomainAction, row: DomainRow, m: ManualDeps, now: number): string | null {
  if (!m.linkSecret) return null;
  const t = signDomainAction(m.linkSecret, { a: action, k: row.original_transaction_id, d: row.domain, s: row.site_slug, exp: now + LINK_TTL_MS });
  return `${m.linkBase.replace(/\/+$/, '')}/api/web-app/domain-action?t=${t}`;
}

const orderLinks = (row: DomainRow, m: ManualDeps, now: number): OrderLinks | null => {
  const live = linkFor('live', row, m, now);
  const cant = linkFor('cant', row, m, now);
  return live && cant ? { live, cant } : null;
};

// ─── facts and mails (exactly once) ───

const subOf = (row: Pick<DomainRow, 'original_transaction_id'>) => row.original_transaction_id.replace(/^stripe:/, '');

function priceText(av: boolean | undefined, p: { purchasePrice: unknown; renewalPrice: unknown } | undefined): string {
  const usd = (x: unknown) => (Number.isFinite(Number(x)) && Number(x) > 0 ? `$${Number(x).toFixed(2)}` : null);
  const first = usd(p?.purchasePrice);
  const renew = usd(p?.renewalPrice);
  const where = av === true ? 'available' : av === false ? 'not available at Vercel (taken, or already on the team)' : 'availability unknown';
  return first ? `${where}, ${first} first year${renew ? `, ${renew} renewal` : ''}` : `${where}, price unavailable`;
}

async function factsFor(row: DomainRow, env: ManualEnv, opts: { sub?: any; ownDetachedName?: boolean } = {}): Promise<OrderFacts> {
  const m = env.manual;
  const slug = row.site_slug;
  const [cust, liveUrl, sub, quote] = await Promise.all([
    m.customerOf(slug).catch(() => ({ email: null, shopName: null })),
    m.liveUrlOf(slug).catch(() => null),
    opts.sub !== undefined ? Promise.resolve(opts.sub) : m.getSubscription ? withTimeout(m.getSubscription(subOf(row)), 6_000, 'subscription').catch(() => null) : Promise.resolve(null),
    (async () => {
      const v = env.flow.vercel;
      if (!v) return priceText(undefined, undefined);
      const [av, pr] = await Promise.all([
        withTimeout(v.availability([row.domain]), 5_000, 'availability').then((x) => x.get(row.domain)).catch(() => undefined),
        withTimeout(v.prices([row.domain]), 5_000, 'prices').then((x) => x.get(row.domain)).catch(() => undefined),
      ]);
      return priceText(av, pr);
    })(),
  ]);
  const customer = typeof sub?.customer === 'string' ? sub.customer : sub?.customer?.id ?? null;
  return {
    domain: row.domain, slug, project: projectFor(slug), liveUrl, customerEmail: cust.email, shopName: cust.shopName,
    subscriptionId: subOf(row), stripeCustomerId: typeof customer === 'string' ? customer : null,
    testMode: sub ? sub.livemode === false : row.simulated, createdAt: row.created_at, priceNote: quote,
    ownDetached: opts.ownDetachedName ?? !!row.last_error?.startsWith('own detached name'), paidUntil: row.paid_until, teamSlug: m.teamSlug ?? null,
  };
}

/**
 * Send the mail `event` of this row once. The marker (alerts_sent[event]) is re-read before sending and
 * written only after Resend accepted it; the Idempotency-Key makes a crash between the two harmless.
 * True when this call sent it. Never throws.
 */
export async function sendRowMailOnce(
  row: Pick<DomainRow, 'original_transaction_id' | 'alerts_sent'>, event: string, to: string, build: () => Promise<Mail> | Mail,
  env: Pick<ManualEnv, 'flow' | 'manual'>, idemSuffix = '',
): Promise<boolean> {
  const otid = row.original_transaction_id;
  const { repo, now } = env.flow;
  let fresh: DomainRow | null;
  try { fresh = await repo.get(otid); } catch (e) { console.error(`[domains/manual] ${otid}: read before mail ${event} failed (retried):`, errMsg(e)); return false; }
  if ((fresh?.alerts_sent ?? row.alerts_sent)?.[event]) return false;
  try {
    await env.manual.sendMail(to, await build(), `domain-${event}:${otid}${idemSuffix}`);
  } catch (e) {
    console.error(`[domains/manual] ${otid}: mail ${event} not sent (retried next sweep):`, errMsg(e));
    return false;
  }
  try {
    const f2 = (await repo.get(otid)) ?? fresh;
    await repo.update(otid, null, { alerts_sent: { ...(f2?.alerts_sent ?? {}), [event]: iso(now()) } });
  } catch (e) {
    console.error(`[domains/manual] ${otid}: mail ${event} sent but its marker was not saved (the Idempotency-Key stops a duplicate):`, errMsg(e));
  }
  return true;
}

/** The order email to Ibrahim and the "we're setting it up" email to the customer, each once. */
export async function sendOrderMails(row: DomainRow, env: ManualEnv, opts: { sub?: any; ownDetachedName?: boolean } = {}): Promise<{ order: boolean; customer: boolean }> {
  const m = env.manual;
  const now = env.flow.now();
  let facts: OrderFacts | null = null;
  const facts_ = async () => (facts ??= await factsFor(row, env, opts));
  const order = await sendRowMailOnce(row, 'order', m.ordersEmail, async () => orderEmail(await facts_(), orderLinks(row, m, now)), env);
  const customer = await sendCustomerMail(row, 'customer-ordered', env, (f) => customerOrderedEmail(f, m.appOrigin), facts_);
  return { order, customer };
}

async function sendCustomerMail(
  row: DomainRow, event: string, env: ManualEnv, build: (f: OrderFacts) => Mail, facts_: () => Promise<OrderFacts>,
): Promise<boolean> {
  if ((await env.flow.repo.get(row.original_transaction_id).catch(() => null))?.alerts_sent?.[event]) return false;
  const f = await facts_();
  if (!f.customerEmail) return false; // unknown address: the order email says so
  return sendRowMailOnce(row, event, f.customerEmail, () => build(f), env);
}

// ─── claim ───

export type ManualClaim =
  | { kind: 'row'; row: DomainRow; created: boolean }
  | { kind: 'refunded'; domain: string; reason?: string | null }
  | { kind: 'needs-support'; code: string }
  | { kind: 'retry' }
  | { kind: 'inactive' }
  | { kind: 'unavailable' };

/**
 * A verified, paid, manual domain subscription → its `awaiting_setup` row, or the refusal (refunded in
 * full: a paid subscription never ends without a row or a refund). Idempotent per subscription (the row
 * key is stripe:<sub id>). Sends no email: the callers do (sendOrderMails), the webhook leaves it to the sweep.
 */
export async function manualClaim(
  sub: any, v: { domain: string; slug: string; subscriptionId: string }, simulated: boolean,
  deps: Pick<WebDomainDeps, 'flow' | 'cancelAndRefund' | 'notifySupport'> & { manual: ManualDeps },
): Promise<ManualClaim> {
  const { repo, now } = deps.flow;
  const payer = stripePayerStatus(sub, now());
  if (!payer.active) return { kind: 'inactive' };
  if (!simulated && !deps.flow.vercel) return { kind: 'unavailable' };
  const key = `stripe:${v.subscriptionId}`;
  const c = { key, slug: v.slug, domain: v.domain, simulated };

  const refuse = async (code: string): Promise<ManualClaim> => {
    const refused = await recordRefusedPaidSlot(c, { body: { error: code } }, deps);
    if (refused.refunded) return { kind: 'refunded', domain: c.domain };
    if (!refused.refundable) return { kind: 'needs-support', code: refused.code };
    return { kind: 'retry' }; // the refund is retried
  };

  try {
    const existing = await repo.get(key);
    if (existing?.refunded_at) return { kind: 'refunded', domain: existing.domain, reason: existing.failure_reason };
    if (existing && existing.state === 'failed' && !existing.vercel_bought_at && WEB_REFUND_REASONS.has(existing.failure_reason || '')) {
      return (await finishRefund(existing, deps)) ? { kind: 'refunded', domain: existing.domain, reason: existing.failure_reason } : { kind: 'retry' };
    }
    if (existing) return { kind: 'row', row: existing, created: false };

    const holder = await repo.holdingSite(v.slug);
    if (holder) return holder.original_transaction_id === key && holder.domain === v.domain ? { kind: 'row', row: holder, created: false } : await refuse('site-has-domain');

    let ownName = false;
    if (!simulated || deps.flow.vercel) {
      const pre = await precheckDomain(deps.flow, v.domain);
      const own = pre === 'domain-taken' ? await ownDetached(deps.flow, v.slug, v.domain) : null;
      if (pre && !own) return await refuse(pre);
      if (own) {
        // The same site buying back its OWN detached name: the old slot hands the registration over.
        await repo.update(own.original_transaction_id, ['detached'], { state: 'failed', failure_reason: 'moved-to-new-subscription', auto_renew: false, last_error: `registration handed over to ${key}` });
        ownName = true;
      }
    }

    const ins = await repo.insertAwaitingSetup({
      original_transaction_id: key, source: 'stripe', environment: 'Production', site_slug: v.slug, domain: v.domain, simulated,
      auto_renew: payer.autoRenew === true, paid_until: payer.expiresAt != null ? iso(payer.expiresAt) : null,
    });
    const row = await repo.get(key);
    if (ins === 'conflict' && (!row || row.domain !== v.domain || row.site_slug !== v.slug)) {
      const h = await repo.holdingSite(v.slug);
      if (h && h.original_transaction_id !== key) return await refuse('site-has-domain');
      return await refuse(row ? 'slot-in-use' : 'domain-taken');
    }
    if (!row) return { kind: 'retry' };
    if (ownName) await repo.update(key, ['awaiting_setup'], { last_error: 'own detached name: already on the Vercel team, re-attach only' }).catch(() => {});
    return { kind: 'row', row, created: ins === 'ok' };
  } catch (e: any) {
    console.error('[PurchaseDomain] manual claim failed:', e?.code || e?.message || e);
    return { kind: 'retry' };
  }
}

/** claimDomainSubscription's answer for a manual subscription (HTTP shape), then the order mails (API paths only). */
export async function claimManualDomain(
  sub: any, v: { domain: string; slug: string; subscriptionId: string }, simulated: boolean,
  deps: Pick<WebDomainDeps, 'flow' | 'cancelAndRefund' | 'notifySupport'> & { manual: ManualDeps },
): Promise<WebResult> {
  const r = await manualClaim(sub, v, simulated, deps);
  switch (r.kind) {
    case 'inactive': return { status: 402, body: { error: 'subscription-inactive' } };
    case 'unavailable': return { status: 503, body: { error: 'domains-unavailable' } };
    case 'refunded': return refundedResult(r.domain, r.reason);
    case 'needs-support':
      return { status: 409, body: { error: r.code, refunded: false, needsSupport: true, message: 'We could not set up this domain. Our team has been notified and will contact you; email support@davoxa.com with any questions.' } };
    case 'retry': return { status: 503, body: { error: 'Try again shortly' } };
    case 'row': {
      if (r.row.state === 'awaiting_setup') {
        // A send failure never fails the claim (logged; the sweep retries).
        await sendOrderMails(r.row, { ...deps, manual: deps.manual }, { sub }).catch((e) => console.error('[domains/manual] order mails threw (the sweep retries):', errMsg(e)));
      }
      const body = webStatusBody(r.row);
      return { status: r.row.state === 'manual_live' ? 200 : r.row.state === 'failed' ? 409 : 202, body: body as unknown as Record<string, unknown> };
    }
  }
}

// ─── Mark live / Can't get this name / Mark ended ───

export interface Check { name: string; ok: boolean; required: boolean; detail: string }

/** Read-only checks before a domain goes live (no writes anywhere). */
export async function liveChecks(row: DomainRow, env: ManualEnv): Promise<{ checks: Check[]; ok: boolean; stub: boolean; payerError: boolean }> {
  const { flow, manual } = env;
  const checks: Check[] = [];
  let payerError = false;
  try {
    const p = await withTimeout(flow.payer(row), 8_000, 'payer status');
    checks.push({ name: 'Subscription active', ok: p.active, required: true, detail: p.active ? 'the $39/year subscription is active' : "the subscription is no longer active; use Can't get this name, or check Stripe" });
  } catch (e) {
    payerError = true;
    checks.push({ name: 'Subscription active', ok: false, required: true, detail: `Stripe did not answer (${errMsg(e)}); try again` });
  }
  if (manual.verifyStub) {
    checks.push({ name: 'STUB', ok: true, required: false, detail: 'staging only: the Vercel attach, DNS and HTTPS checks are skipped (DOMAIN_LIVE_VERIFY_STUB)' });
    return { checks, ok: checks.every((c) => c.ok || !c.required), stub: true, payerError };
  }
  const v = flow.vercel;
  const project = projectFor(row.site_slug);
  if (!v) {
    checks.push({ name: 'Vercel', ok: false, required: true, detail: 'VERCEL_TOKEN is not set on the server' });
  } else {
    const [pd, www, cfg, https] = await Promise.all([
      withTimeout(v.projectDomain(project, row.domain), 6_000, 'project domain').then((x) => ({ x }), (e) => ({ e })),
      withTimeout(v.projectDomain(project, `www.${row.domain}`), 6_000, 'www domain').then((x) => ({ x }), (e) => ({ e })),
      withTimeout(v.domainConfig(row.domain), 6_000, 'domain config').then((x) => ({ x }), (e) => ({ e })),
      flow.probeHttps ? withTimeout(flow.probeHttps(row.domain), 7_000, 'https').then((x) => ({ x }), () => ({ x: false })) : Promise.resolve({ x: null as boolean | null }),
    ]);
    const att = 'e' in pd ? null : pd.x;
    checks.push({ name: `On project ${project}`, ok: !!att, required: true, detail: 'e' in pd ? `Vercel did not answer (${errMsg(pd.e)})` : att ? 'attached' : `${row.domain} is not on project ${project}: add it in Settings, Domains` });
    checks.push({ name: 'Domain verified', ok: !!att?.verified, required: true, detail: att ? (att.verified ? 'verified' : 'not verified yet') : 'not attached' });
    const misconfigured = 'e' in cfg ? null : cfg.x ? cfg.x.misconfigured : null;
    checks.push({ name: 'DNS correct', ok: misconfigured === false, required: true, detail: misconfigured === false ? 'Valid configuration' : misconfigured === true ? 'DNS is not pointed at Vercel yet (misconfigured)' : 'Vercel did not report a DNS configuration' });
    checks.push({ name: 'HTTPS answers', ok: https.x === true, required: true, detail: https.x === true ? `https://${row.domain}/ answers` : `https://${row.domain}/ does not answer yet (certificate or DNS still pending)` });
    const wd = 'e' in www ? null : www.x;
    checks.push({ name: `www.${row.domain} on the project`, ok: !!wd, required: false, detail: wd ? 'present' : 'missing (warning only): add www.' + row.domain + ' with a 308 redirect to the apex' });
  }
  return { checks, ok: checks.every((c) => c.ok || !c.required), stub: false, payerError };
}

// ─── pages ───

export interface PageResult { status: number; html: string }
const H = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

function page(title: string, body: string, status = 200): PageResult {
  return {
    status,
    html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${H(title)}</title></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;max-width:560px;margin:32px auto;padding:0 16px;color:#111;line-height:1.45"><h1 style="font-size:22px">${H(title)}</h1>${body}</body></html>`,
  };
}
const msg = (title: string, text: string, status = 200) => page(title, `<p>${H(text)}</p>`, status);
const checkTable = (cs: Check[]) =>
  `<table style="border-collapse:collapse;width:100%">${cs.map((c) => `<tr><td style="padding:6px 8px 6px 0;vertical-align:top;white-space:nowrap">${c.ok ? 'OK' : c.required ? 'FAIL' : 'WARN'}</td><td style="padding:6px 0"><b>${H(c.name)}</b><br><span style="color:#555">${H(c.detail)}</span></td></tr>`).join('')}</table>`;
const form = (token: string, label: string) =>
  `<form method="post" style="margin-top:20px"><input type="hidden" name="t" value="${H(token)}"><button type="submit" style="font-size:16px;padding:12px 18px;border-radius:8px;border:0;background:#111;color:#fff">${H(label)}</button></form>`;

async function load(token: string, env: ManualEnv): Promise<{ p: ActionPayload; row: DomainRow } | PageResult> {
  const secret = env.manual.linkSecret;
  if (!secret) return msg('Links are off', 'DOMAIN_ADMIN_LINK_SECRET is not set on the server.', 503);
  const p = verifyDomainAction(token, secret, env.flow.now());
  if (!p) return msg('Link not valid', 'This link is invalid or has expired. A reminder email carries fresh links.', 403);
  let row: DomainRow | null;
  try { row = await env.flow.repo.get(p.k); } catch { return msg('Try again', 'The database did not answer. Reload in a minute.', 503); }
  if (!row || row.source !== 'stripe' || row.domain !== p.d || row.site_slug !== p.s) return msg('Link not valid', 'This link does not match an order.', 403);
  return { p, row };
}

const endedOnPage = (row: DomainRow) => (row.state === 'transferred' && row.transferred_by === 'manual-ended');

/** GET: show what the action would do and the checks. Writes nothing (no Stripe, no Vercel write, no row change). */
export async function domainActionView(token: unknown, env: ManualEnv): Promise<PageResult> {
  const l = await load(String(token ?? ''), env);
  if ('html' in l) return l;
  const { p, row } = l;
  const t = String(token);
  const facts = `<p><b>${H(row.domain)}</b> for site ${H(row.site_slug)}</p>`;
  if (p.a === 'live') {
    if (row.state === 'manual_live') return msg('Already live', `${row.domain} is already marked live.`);
    if (row.state !== 'awaiting_setup') return msg('Already done', `This order is no longer waiting (${row.state}).`);
    const r = await liveChecks(row, env);
    return page(`Mark ${row.domain} live`, `${facts}${checkTable(r.checks)}${r.ok
      ? `<p>Everything required is green. Pressing the button republishes the site on https://${H(row.domain)} and emails the customer.</p>${form(t, 'Mark live')}`
      : '<p>Fix the red items and reload this page. The button appears when everything required is green.</p>'}`);
  }
  if (p.a === 'cant') {
    if (row.state === 'failed' && row.alerts_sent?.['manual-refund']) return msg('Already done', `${row.domain} was already closed and refunded${row.refunded_at ? '' : ' (the refund is being retried)'}.`);
    if (row.state !== 'awaiting_setup') return msg('Already done', `This order is no longer waiting (${row.state}).`);
    return page(`Can't get ${row.domain}`, `${facts}<p>Pressing the button cancels the $39 subscription, refunds it in full and emails the customer to pick another name. This cannot be undone.</p>${form(t, "Can't get this name: refund $39")}`);
  }
  // end
  if (endedOnPage(row)) return msg('Already ended', `${row.domain} was already marked ended.`);
  if (row.state !== 'manual_live') return msg('Not live', `${row.domain} is not a live manual domain (${row.state}).`);
  const chk: Check[] = [];
  try {
    const s = await withTimeout(env.flow.payer(row), 8_000, 'payer status');
    chk.push({ name: 'Subscription over', ok: !s.active, required: true, detail: s.active ? `still paid${s.expiresAt ? ` until ${iso(s.expiresAt)}` : ''}: not yet` : 'the subscription is no longer active' });
  } catch (e) { chk.push({ name: 'Subscription over', ok: false, required: true, detail: `Stripe did not answer (${errMsg(e)})` }); }
  if (!env.manual.verifyStub && env.flow.vercel) {
    const att = await withTimeout(env.flow.vercel.projectDomain(projectFor(row.site_slug), row.domain), 6_000, 'project domain').catch(() => undefined);
    chk.push({ name: 'Removed from the Vercel project', ok: att === null, required: true, detail: att === null ? 'not attached any more' : att === undefined ? 'Vercel did not answer' : `still attached to ${projectFor(row.site_slug)}: remove it first` });
  }
  const ok = chk.every((c) => c.ok);
  return page(`Mark ${row.domain} ended`, `${facts}${checkTable(chk)}${ok ? `<p>Pressing the button republishes the site on its free address and closes the order.</p>${form(t, 'Mark ended')}` : '<p>Not ready: fix the red items and reload.</p>'}`);
}

/** POST: act. Idempotent: a replay finds the row moved and answers "already done" (no second mail, no second refund). */
export async function runDomainAction(token: unknown, env: ManualEnv): Promise<PageResult> {
  const l = await load(String(token ?? ''), env);
  if ('html' in l) return l;
  const { p } = l;
  const { repo, now, hooks } = env.flow;
  const m = env.manual;
  const key = p.k;
  let row = l.row;

  if (p.a === 'live') {
    if (row.state === 'manual_live') return msg('Already live', `${row.domain} is already marked live.`);
    if (row.state !== 'awaiting_setup') return msg('Already done', `This order is no longer waiting (${row.state}).`);
    const r = await liveChecks(row, env);
    if (!r.ok) return page(`Not live yet: ${row.domain}`, `${checkTable(r.checks)}<p>Nothing was changed. Fix the red items and try again.</p>`, 409);
    try {
      await hooks.onDomainLinked(row.site_slug, row.domain);
    } catch (e) {
      console.error(`[domains/manual] ${key}: republish on Mark live failed (row unchanged):`, errMsg(e));
      return msg('Republish failed', 'The site could not be republished on the new address. Nothing was changed; press the link again in a minute.', 502);
    }
    const at = iso(now());
    const moved = await repo.update(key, ['awaiting_setup'], { state: 'manual_live', linked_at: at, dns_ready_at: at, last_error: null });
    if (!moved) {
      const cur = await repo.get(key);
      return cur?.state === 'manual_live' ? msg('Already live', `${row.domain} is already marked live.`) : msg('Already done', `This order is no longer waiting (${cur?.state ?? 'unknown'}).`);
    }
    row = moved;
    const mailed = await sendLiveMail(row, env);
    const canonical = m.fetchCanonical ? await withTimeout(m.fetchCanonical(row.domain), 8_000, 'canonical').catch(() => null) : null;
    return page(`${row.domain} is live`, `<p>The site was republished on https://${H(row.domain)} and the row is marked live.</p><p>Customer email: ${mailed ? 'sent' : 'not sent yet (the sweep retries)'}.</p>${r.stub ? '<p><b>STUB:</b> Vercel / HTTPS were not checked (staging).</p>' : ''}<p>Canonical found on the live page (display only): ${canonical ? H(canonical) : 'none found'}</p>`);
  }

  if (p.a === 'cant') {
    if (row.state === 'awaiting_setup') {
      const moved = await repo.update(key, ['awaiting_setup'], {
        state: 'failed', failure_reason: 'taken', last_error: "manual: operator could not register this name", auto_renew: false,
        alerts_sent: { ...(row.alerts_sent ?? {}), 'manual-refund': iso(now()) },
      });
      if (!moved) row = (await repo.get(key)) ?? row;
      else row = moved;
    }
    if (!(row.state === 'failed' && row.alerts_sent?.['manual-refund'])) return msg('Already done', `This order is no longer waiting (${row.state}).`);
    const settled = await settleWebFailure(row, { repo, now, notifySupport: env.notifySupport ?? env.flow.notifySupport, cancelAndRefund: env.cancelAndRefund });
    const after = (await repo.get(key)) ?? row;
    if (!settled || !after.refunded_at) {
      return msg('Refund pending', 'The order is closed but the refund did not go through yet. It is retried automatically every 10 minutes; check Stripe if it keeps failing. The customer is emailed once the refund is made.', 202);
    }
    const mailed = await sendRefundedMail(after, env);
    return msg('Refunded', `${after.domain}: the subscription is cancelled and the $39 refunded in full. Customer email: ${mailed ? 'sent' : 'not sent yet (the sweep retries)'}.`);
  }

  // end
  if (endedOnPage(row)) return msg('Already ended', `${row.domain} was already marked ended.`);
  if (row.state !== 'manual_live') return msg('Not live', `${row.domain} is not a live manual domain (${row.state}).`);
  let s;
  try { s = await withTimeout(env.flow.payer(row), 8_000, 'payer status'); } catch (e) {
    return msg('Try again', `Stripe did not answer (${errMsg(e)}). Nothing was changed.`, 503);
  }
  if (s.active) return msg('Still paid', `The subscription is still active${s.expiresAt ? ` until ${iso(s.expiresAt)}` : ''}. Nothing was changed.`, 409);
  if (!m.verifyStub && env.flow.vercel) {
    const att = await withTimeout(env.flow.vercel.projectDomain(projectFor(row.site_slug), row.domain), 6_000, 'project domain').catch(() => undefined);
    if (att) return msg('Still on the project', `${row.domain} is still attached to Vercel project ${projectFor(row.site_slug)}. Remove it first (the republish would keep it as the address). Nothing was changed.`, 409);
  }
  try { await hooks.onDomainUnlinked(row.site_slug); } catch (e) {
    console.error(`[domains/manual] ${key}: republish on Mark ended failed (row unchanged):`, errMsg(e));
    return msg('Republish failed', 'The site could not be republished on its free address. Nothing was changed; press the link again in a minute.', 502);
  }
  const at = iso(now());
  const moved = await repo.update(key, ['manual_live'], { state: 'transferred', transferred_at: at, transferred_by: 'manual-ended', detached_at: at, auto_renew: false });
  if (!moved) return msg('Already ended', `${row.domain} was already marked ended.`);
  return msg('Ended', `${row.domain} is closed: the site is back on its free address and the customer sees it as expired.`);
}

async function sendLiveMail(row: DomainRow, env: ManualEnv): Promise<boolean> {
  const f = await factsFor(row, env);
  if (!f.customerEmail) return false;
  return sendRowMailOnce(row, 'customer-live', f.customerEmail, () => customerLiveEmail(f, env.manual.appOrigin), env);
}

async function sendRefundedMail(row: DomainRow, env: ManualEnv): Promise<boolean> {
  if (row.alerts_sent?.['customer-refunded']) return false;
  const f = await factsFor(row, env);
  if (!f.customerEmail) return false;
  return sendRowMailOnce(row, 'customer-refunded', f.customerEmail, () => customerRefundedEmail(f, env.manual.appOrigin), env);
}

// ─── sweep ───

export interface ManualSweepSummary {
  orderMails: string[]; customerMails: string[]; reminders: string[]; voids: string[]; ended: string[]; renewalDue: string[];
  refundMails: string[]; liveMails: string[]; alerted: string[]; refreshed: string[]; errors: string[];
}

/**
 * The web pass inside the domain sweep (every 10 min). Deadline-aware; every write is conditional on the row's
 * state and every mail is once-only, so overlapping runs are safe.
 */
export async function sweepManualDomains(env: ManualEnv, deadline: number): Promise<ManualSweepSummary> {
  const { repo, now } = env.flow;
  const m = env.manual;
  const out: ManualSweepSummary = { orderMails: [], customerMails: [], reminders: [], voids: [], ended: [], renewalDue: [], refundMails: [], liveMails: [], alerted: [], refreshed: [], errors: [] };
  const all = await repo.all();
  const alertDeps = { repo, now, notifySupport: env.notifySupport ?? env.flow.notifySupport };
  const unsent = async (row: DomainRow, event: string, since: string | null, what: string) => {
    const t = Date.parse(since || '');
    if (!Number.isFinite(t) || now() - t < UNSENT_ALERT_MS) return;
    const fresh = (await repo.get(row.original_transaction_id).catch(() => null)) ?? row;
    if (fresh.alerts_sent?.[event]) return;
    if (await alertOnce(fresh, `alert:${event}`, `Domain email not sent for 24 hours: ${row.domain}`,
      `The "${what}" email of a manual domain order could not be sent for over 24 hours. Check RESEND_API_KEY / the sender, then the sweep retries by itself.\n\nDomain: ${row.domain}\nSite: ${row.site_slug}\nSubscription: ${subOf(row)}\nEvent: ${event}`, alertDeps)) out.alerted.push(row.domain);
  };

  for (const cand of all) {
    if (cand.source !== 'stripe') continue;
    if (now() >= deadline) break;
    try {
      const row = (await repo.get(cand.original_transaction_id)) ?? cand;

      if (row.state === 'awaiting_setup') {
        const sent = await sendOrderMails(row, env);
        if (sent.order) out.orderMails.push(row.domain);
        if (sent.customer) out.customerMails.push(row.domain);
        let cur = (await repo.get(row.original_transaction_id)) ?? row;
        if (!cur.alerts_sent?.order) await unsent(cur, 'order', cur.created_at, 'order');
        // Is the order void (cancelled now / refunded / account deleted)? Revoked, else ask the payer at most every 12 h.
        let inactive = !!cur.revoked_at;
        if (!inactive && (!cur.payer_checked_at || now() - Date.parse(cur.payer_checked_at) >= PAYER_REFRESH_MS)) {
          const s = await withTimeout(env.flow.payer(cur), 8_000, 'payer status');
          cur = await refreshFromPayer(cur, s, env.flow);
          out.refreshed.push(cur.domain);
          inactive = !s.active || !!cur.revoked_at;
        }
        if (inactive && !cur.alerts_sent?.['order-void']) {
          const f = await factsFor(cur, env);
          if (await sendRowMailOnce(cur, 'order-void', m.ordersEmail, () => orderVoidEmail(f, orderLinks(cur, m, now()), 'subscription'), env)) out.voids.push(cur.domain);
        } else if (!inactive && cur.alerts_sent?.order && !cur.alerts_sent?.['order-reminder'] && now() - Date.parse(cur.created_at) >= ORDER_REMINDER_MS) {
          const f = await factsFor(cur, env);
          if (await sendRowMailOnce(cur, 'order-reminder', m.ordersEmail, () => orderReminderEmail(f, orderLinks(cur, m, now())), env)) out.reminders.push(cur.domain);
        }
        continue;
      }

      if (row.state === 'manual_live') {
        let cur = row;
        if (!cur.payer_checked_at || now() - Date.parse(cur.payer_checked_at) >= PAYER_REFRESH_MS) {
          const s = await withTimeout(env.flow.payer(cur), 8_000, 'payer status');
          cur = await refreshFromPayer(cur, s, env.flow);
          out.refreshed.push(cur.domain);
          if (!s.active && !cur.alerts_sent?.ended) {
            const f = await factsFor(cur, env);
            if (await sendRowMailOnce(cur, 'ended', m.ordersEmail, () => endedEmail(f, linkFor('end', cur, m, now())), env)) out.ended.push(cur.domain);
          }
        }
        cur = (await repo.get(cur.original_transaction_id)) ?? cur;
        if (cur.auto_renew && cur.paid_until && Date.parse(cur.paid_until) - now() <= RENEWAL_DUE_MS) {
          const due = iso(Date.parse(cur.paid_until));
          const f = await factsFor(cur, env);
          if (await sendRowMailOnce(cur, `renewal-due:${due}`, m.ordersEmail, () => renewalDueEmail(f, due), env, `:${due}`)) out.renewalDue.push(cur.domain);
        }
        if (!cur.alerts_sent?.['customer-live']) {
          if (await sendLiveMail(cur, env)) out.liveMails.push(cur.domain);
          else await unsent(cur, 'customer-live', cur.linked_at, 'customer live');
        }
        continue;
      }

      if (row.state === 'failed' && row.alerts_sent?.['manual-refund'] && row.refunded_at && !row.alerts_sent['customer-refunded']
        && now() - Date.parse(row.refunded_at) < 30 * DAY) {
        if (await sendRefundedMail(row, env)) out.refundMails.push(row.domain);
        else await unsent(row, 'customer-refunded', row.refunded_at, 'customer refund');
        continue;
      }

      // The owner removed the site / deleted the account while the order was waiting (releaseDomainsForRemoval).
      if (row.state === 'detached' && row.failure_reason === OWNER_REMOVED && !row.linked_at && row.alerts_sent?.order && !row.alerts_sent['order-void']) {
        const f = await factsFor(row, env);
        if (await sendRowMailOnce(row, 'order-void', m.ordersEmail, () => orderVoidEmail(f, null, 'owner-removed'), env)) out.voids.push(row.domain);
      }
    } catch (e) {
      const why = e instanceof PayerFailure ? `payer ${e.code}` : errMsg(e);
      out.errors.push(`${cand.original_transaction_id}: ${why}`);
      console.error(`[Sweeper:manual-domains] ${cand.original_transaction_id}:`, why);
    }
  }
  return out;
}
