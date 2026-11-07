// One-tap "finish my website" link from the sign-up reminder mails. Pure logic with injected deps (live deps below).
//   GET  -> preview(): verifies the token locally (no DB, no Supabase) and decides which page to render. Link scanners
//           only ever GET, so nothing can be consumed by them.
//   POST -> performContinue(): token (mode + signature + expiry) -> nudge row for (user, mode) must exist and have that
//           step's mail sent -> single use per step (10 min grace) -> account exists -> NOT paid -> Supabase magic link is
//           minted and consumed here on the server -> only the two session cookies leave this function. The browser never
//           sees a Supabase token. Redirect targets come from a fixed list; nothing is read from the request.
// Tokens, token hashes, session tokens and the query string are never logged.
import { verifyContinueToken } from './nudgeToken.js';
import { cookieFor, hintFor } from './sessionCookie.js';
import { sbRest } from './webAppServer.js';
import { esc } from './emails.js';
import { liveSignupNudgeDeps } from './signupNudges.js';

type Mode = 'live' | 'test';
export const USED_GRACE_MS = 10 * 60_000;
export const SIGN_IN_PATH = '/app/sign-in';
const appPath = (step: 1 | 2 | 3) => `/app/?from=nudge${step}`;

export interface ContinueRow {
  step1_sent_at: string | null; step2_sent_at: string | null; step3_sent_at: string | null;
  links_used: Record<string, string> | null;
  stopped_at?: string | null; stop_reason?: string | null;
}
export interface ContinueDeps {
  mode: Mode;
  secret: string;
  now(): number;
  /** The nudge row for (user, this deployment's mode), or null. */
  row(userId: string): Promise<ContinueRow | null>;
  /** The account's email; null when the account is gone. Throws on any other problem. */
  email(userId: string): Promise<string | null>;
  /** Entitled in the DB (any environment) OR a completed Stripe payment. Throws on error: never sign in on a doubt. */
  isPaid(userId: string, email: string): Promise<boolean>;
  markPaid(userId: string): Promise<void>;
  stampLinkUsed(userId: string, step: 1 | 2 | 3, row: ContinueRow, nowIso: string): Promise<void>;
  /** Admin magic link -> hashed token (nothing is emailed). */
  generateLink(email: string): Promise<string>;
  /** Consume the hashed token server-side; the session's refresh token and user id. */
  consume(tokenHash: string): Promise<{ refreshToken: string; userId: string | null }>;
}

export type PageState = 'form' | 'expired' | 'used' | 'gone' | 'unavailable';
export type ContinueOutcome =
  | { kind: 'page'; state: PageState }
  | { kind: 'redirect'; location: string; cookies: string[] };

/** GET: no DB, no Supabase. A valid, unexpired token for this mode shows the button; anything else shows "expired". */
export function previewContinue(token: unknown, deps: Pick<ContinueDeps, 'mode' | 'secret' | 'now'>): { state: PageState; hint: string | null } {
  const t = verifyContinueToken(token, { now: deps.now(), secret: deps.secret, mode: deps.mode });
  return t.ok ? { state: 'form', hint: t.hint } : { state: 'expired', hint: null };
}
/** Rows stopped for these reasons belong to someone who already pays, has a live site, or is an iOS/legacy customer: never auto sign in. */
const NO_AUTO_SIGN_IN = new Set(['paid', 'not_web', 'live']);

export async function performContinue(token: unknown, deps: ContinueDeps): Promise<ContinueOutcome> {
  const t = verifyContinueToken(token, { now: deps.now(), secret: deps.secret, mode: deps.mode });
  if (!t.ok) return { kind: 'page', state: 'expired' };
  const { userId, step } = t;
  try {
    const row = await deps.row(userId);
    // A token for an unsent step never exists: no row, or no mail for that step, means this is not a link we sent.
    if (!row || !(row as any)[`step${step}_sent_at`]) return { kind: 'page', state: 'expired' };
    if (row.stop_reason && NO_AUTO_SIGN_IN.has(row.stop_reason)) return { kind: 'redirect', location: SIGN_IN_PATH, cookies: [] };
    const first = row.links_used?.[String(step)];
    if (first && deps.now() - Date.parse(first) > USED_GRACE_MS) return { kind: 'page', state: 'used' };

    const email = await deps.email(userId);
    if (!email) return { kind: 'page', state: 'gone' };
    // A paid account (live site, bookings, customer data) is not worth a bearer link: plain sign-in instead.
    if (await deps.isPaid(userId, email)) {
      await deps.markPaid(userId).catch(() => {});
      return { kind: 'redirect', location: SIGN_IN_PATH, cookies: [] };
    }
    const session = await deps.consume(await deps.generateLink(email));
    if (!session.refreshToken || !session.userId || session.userId !== userId) return { kind: 'page', state: 'unavailable' };
    // The first click starts the grace window; a refresh inside it keeps the original stamp.
    if (!first) await deps.stampLinkUsed(userId, step, row, new Date(deps.now()).toISOString());
    return { kind: 'redirect', location: appPath(step), cookies: [cookieFor(session.refreshToken), hintFor()] };
  } catch (e: any) {
    console.error('[web-app continue] failed', userId, step, e?.status ?? e?.message ?? 'error'); // ids only, never tokens
    return { kind: 'page', state: 'unavailable' };
  }
}

// ---------- pages (shared with the unsubscribe handler) ----------
export function mailPage(opts: { heading: string; body: string; button?: { label: string; href?: string; formAction?: string; fields?: Record<string, string> }; alt?: { label: string; href: string } }): string {
  const b = opts.button;
  const btn = !b ? '' : b.formAction
    ? `<form method="POST" action="${esc(b.formAction)}" style="margin:0 0 16px">${Object.entries(b.fields ?? {}).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('')}<button type="submit" style="${BTN}">${esc(b.label)}</button></form>`
    : `<p style="margin:0 0 16px"><a href="${esc(b.href ?? '#')}" style="${BTN};text-decoration:none;display:inline-block">${esc(b.label)}</a></p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Prime Barber</title></head>
<body style="margin:0;padding:24px 16px;background:#fff;color:#111;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif">
<div style="max-width:420px;margin:0 auto"><p style="margin:0 0 12px;font-size:20px;font-weight:600">${esc(opts.heading)}</p>
<p style="margin:0 0 20px;font-size:15px;line-height:22px">${esc(opts.body)}</p>${btn}${opts.alt ? `<p style="margin:0;font-size:14px"><a href="${esc(opts.alt.href)}" style="color:#0b57d0">${esc(opts.alt.label)}</a></p>` : ''}</div></body></html>`;
}
const BTN = 'padding:13px 26px;background-color:#0b57d0;border:0;border-radius:8px;color:#ffffff;font-size:16px;font-weight:600;line-height:20px;cursor:pointer';

export function continuePage(state: PageState, token?: string, hint?: string | null): string {
  const signIn = { label: 'Sign in', href: SIGN_IN_PATH };
  switch (state) {
    case 'form': return mailPage({
      heading: 'Open your Prime Barber website',
      body: hint ? `This link signs in ${hint}. Tap the button to pick up where you left off.` : 'Tap the button to sign in and pick up where you left off.',
      button: { label: hint ? `Continue as ${hint}` : 'Continue', formAction: '/api/web-app/continue', fields: { t: token ?? '' } },
      alt: { label: 'Not you? Sign in', href: SIGN_IN_PATH },
    });
    case 'used': return mailPage({ heading: 'This link was already used', body: 'For your security each link works once. Sign in to open your website.', button: signIn });
    case 'gone': return mailPage({ heading: 'We could not find this account', body: 'The account for this link no longer exists.', button: signIn });
    case 'unavailable': return mailPage({ heading: "We couldn't sign you in right now", body: 'Please try the link again in a minute, or sign in the usual way.', button: signIn });
    default: return mailPage({ heading: 'This link has expired', body: 'Sign in to open your website.', button: signIn });
  }
}

// ---------- live deps ----------
const enc = encodeURIComponent;
export function liveContinueDeps(mode: Mode, secret: string, rest: typeof sbRest = sbRest): ContinueDeps {
  const nd = liveSignupNudgeDeps(mode, rest);
  const url = () => process.env.SUPABASE_URL as string;
  const svc = () => process.env.SUPABASE_SERVICE_ROLE_KEY as string;
  return {
    mode, secret, now: () => Date.now(),
    async row(uid) {
      return (await rest(`web_app_signup_nudges?user_id=eq.${enc(uid)}&environment=eq.${mode}&select=step1_sent_at,step2_sent_at,step3_sent_at,links_used,stopped_at,stop_reason&limit=1`))?.[0] ?? null;
    },
    async email(uid) { const u = await nd.adminUser(uid); return u ? (u.email?.trim() || null) : null; },
    async isPaid(uid, email) { return (await nd.isEntitled(uid)) || (await nd.stripePaid(email, uid)); },
    markPaid: (uid) => nd.stop(uid, 'paid', new Date().toISOString()),
    async stampLinkUsed(uid, step, row, nowIso) {
      await rest(`web_app_signup_nudges?user_id=eq.${enc(uid)}&environment=eq.${mode}`, { method: 'PATCH', prefer: 'return=minimal', body: { links_used: { ...(row.links_used ?? {}), [String(step)]: nowIso } } });
    },
    async generateLink(email) {
      const r = await fetch(`${url()}/auth/v1/admin/generate_link`, { method: 'POST', headers: { apikey: svc(), Authorization: `Bearer ${svc()}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', email }) });
      if (!r.ok) throw Object.assign(new Error('generate_link failed'), { status: r.status });
      const j: any = await r.json().catch(() => null);
      const h = j?.hashed_token ?? j?.properties?.hashed_token;
      if (typeof h !== 'string' || !h) throw new Error('generate_link returned no token');
      return h;
    },
    async consume(tokenHash) {
      const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
      if (!anon) throw new Error('anon key missing');
      const r = await fetch(`${url()}/auth/v1/verify`, { method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'magiclink', token_hash: tokenHash }) });
      if (!r.ok) throw Object.assign(new Error('verify failed'), { status: r.status });
      const j: any = await r.json().catch(() => null);
      if (!j?.refresh_token) throw new Error('verify returned no session');
      return { refreshToken: j.refresh_token, userId: j.user?.id ?? null }; // the access token is discarded
    },
  };
}
