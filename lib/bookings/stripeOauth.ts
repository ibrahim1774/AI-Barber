import crypto from 'node:crypto';
import {
  SITE_ORIGIN, STRIPE_TIMEOUT_MS, StripeApiError, fetchAccountStatus, ownerShop,
  type FetchLike, type OwnerStripeDeps,
} from './payments.js';
import { keyMode } from '../webApp/stripeCore.js';

/**
 * "Connect an existing Stripe account" (Stripe Connect OAuth, Standard accounts).
 *
 * The client id (STRIPE_CONNECT_CLIENT_ID, a ca_ id) must be the same mode as STRIPE_CONNECT_SECRET_KEY
 * (the key stripeRequest uses): a test ca_ id with sk_test_..., a live ca_ id with sk_live_....
 * Redirect URI to register in the Connect settings of each mode: `${oauthOrigin()}/api/shop/stripe/oauth-return`.
 */

export const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;
const STATE_LABEL = 'pb-stripe-oauth-state-v1';
const LINK_LABEL = 'pb-stripe-oauth-link-v1';
export const LINK_TTL_MS = 10 * 60 * 1000;

/** The origin Stripe redirects back to (this API). Fixed, never taken from request headers. */
export const oauthOrigin = () => process.env.STRIPE_OAUTH_REDIRECT_ORIGIN || SITE_ORIGIN;
export const oauthRedirectUri = () => `${oauthOrigin()}/api/shop/stripe/oauth-return`;

export interface OauthState { shopId: string; userId: string; webBase: string; exp: number; nonce: string }
export interface LinkToken { shopId: string; userId: string; account: string; exp: number }

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');

function keyFor(label: string): Buffer {
  const sk = process.env.STRIPE_CONNECT_SECRET_KEY;
  if (!sk) throw new StripeApiError('missing STRIPE_CONNECT_SECRET_KEY', 500, 'config');
  return crypto.createHmac('sha256', sk).update(label).digest();
}

function signWith(label: string, payload: object): string {
  const p = b64u(JSON.stringify(payload));
  return `${p}.${b64u(crypto.createHmac('sha256', keyFor(label)).update(p).digest())}`;
}

function verifyWith(label: string, token: unknown): any | null {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    const want = crypto.createHmac('sha256', keyFor(label)).update(parts[0]).digest();
    const got = Buffer.from(parts[1], 'base64url');
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
    return JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  } catch { return null; }
}

export function signOauthState(s: Omit<OauthState, 'exp' | 'nonce'>, now = Date.now()): string {
  return signWith(STATE_LABEL, { ...s, exp: now + OAUTH_STATE_TTL_MS, nonce: crypto.randomBytes(12).toString('hex') });
}

export function verifyOauthState(token: unknown, now = Date.now()): OauthState | null {
  const s = verifyWith(STATE_LABEL, token);
  if (!s || typeof s.shopId !== 'string' || typeof s.userId !== 'string' || typeof s.webBase !== 'string'
    || typeof s.nonce !== 'string' || typeof s.exp !== 'number' || s.exp < now) return null;
  return s;
}

export function signLinkToken(s: Omit<LinkToken, 'exp'>, now = Date.now()): string {
  return signWith(LINK_LABEL, { ...s, exp: now + LINK_TTL_MS });
}

export function verifyLinkToken(token: unknown, now = Date.now()): LinkToken | null {
  const s = verifyWith(LINK_LABEL, token);
  if (!s || typeof s.shopId !== 'string' || typeof s.userId !== 'string' || typeof s.account !== 'string'
    || !/^acct_\w+$/.test(s.account) || typeof s.exp !== 'number' || s.exp < now) return null;
  return s;
}

export interface OauthDeps extends OwnerStripeDeps {
  /** The shop (if any) that already stores this connected account id. */
  shopIdByAccount(accountId: string): Promise<string | null>;
  /** Swap the stored id only while it still equals `oldId`; true when the row changed. */
  replaceAccountId(shopId: string, oldId: string, newId: string): Promise<boolean>;
  /** True when the shop has any appointment or store order carrying a Stripe payment intent / checkout session id. */
  hasCardHistory(shopId: string): Promise<boolean>;
}

type Reply = { status: number; body: object };

/** POST /api/shop/stripe/connect-existing -> { url }; with { token } it finishes a link (confirm). */
export async function stripeConnectExisting(authorization: string | string[] | undefined, deps: OwnerStripeDeps, input?: { token?: unknown }): Promise<Reply> {
  if (input && input.token !== undefined) return stripeConnectConfirm(authorization, input.token, deps as OauthDeps);
  const clientId = process.env.STRIPE_CONNECT_CLIENT_ID;
  if (!clientId) return { status: 503, body: { error: 'connect-existing-unavailable' } };
  const r = await ownerShop(authorization, deps);
  if ('status' in r) return r;
  const { user, shop } = r;
  const webBase = await deps.webReturnBase?.(user.id).catch(() => null);
  if (!webBase) return { status: 403, body: { error: 'web-only' } };
  let state: string;
  try { state = signOauthState({ shopId: shop.id, userId: user.id, webBase }); } catch (e: any) {
    console.error('[shop/stripe/connect-existing] failed:', e?.message || e);
    return { status: 502, body: { error: 'stripe-error' } };
  }
  const q = new URLSearchParams({ response_type: 'code', client_id: clientId, scope: 'read_write', redirect_uri: oauthRedirectUri(), stripe_landing: 'login', state });
  if (user.email) q.set('stripe_user[email]', user.email);
  if (shop.name) q.set('stripe_user[business_name]', shop.name);
  return { status: 200, body: { url: `https://connect.stripe.com/oauth/authorize?${q.toString()}` } };
}

export type Redirect = { redirect: string } | { status: number; text: string };

/** Best effort: drop the platform's access to an account that did not end up linked. Never touches an account stored on any shop. */
export async function deauthorizeIfUnlinked(accountId: string, deps: Pick<OauthDeps, 'shopIdByAccount' | 'stripe'>): Promise<void> {
  try {
    const key = process.env.STRIPE_CONNECT_SECRET_KEY;
    const clientId = process.env.STRIPE_CONNECT_CLIENT_ID;
    if (!key || !clientId) return;
    if (await deps.shopIdByAccount(accountId)) return;
    await (deps.stripe?.fetch ?? (fetch as unknown as FetchLike))('https://connect.stripe.com/oauth/deauthorize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: clientId, stripe_user_id: accountId }).toString(),
      signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS),
    });
  } catch (e: any) {
    console.error('[shop/stripe/oauth] deauthorize failed:', e?.name);
  }
}

async function exchangeCode(code: string, f?: FetchLike): Promise<{ account: string; livemode: boolean | null }> {
  const key = process.env.STRIPE_CONNECT_SECRET_KEY;
  if (!key) throw new StripeApiError('missing STRIPE_CONNECT_SECRET_KEY', 500, 'config');
  const res = await (f ?? (fetch as unknown as FetchLike))('https://connect.stripe.com/oauth/token', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code }).toString(),
    signal: AbortSignal.timeout(STRIPE_TIMEOUT_MS),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || typeof json?.stripe_user_id !== 'string' || !/^acct_\w+$/.test(json.stripe_user_id)) {
    throw new StripeApiError(json?.error_description || json?.error || 'oauth token exchange failed', res.ok ? 502 : res.status, json?.error);
  }
  return { account: json.stripe_user_id, livemode: typeof json.livemode === 'boolean' ? json.livemode : null };
}

/**
 * GET /api/shop/stripe/oauth-return?code&state (or &error). Unauthenticated, so it never writes the shop: it only
 * exchanges the code and hands a short-lived signed link token to the web app, which finishes with the owner's JWT.
 */
export async function stripeOauthReturn(q: { code?: unknown; state?: unknown; error?: unknown }, deps: OauthDeps, now = Date.now()): Promise<Redirect> {
  const state = verifyOauthState(q.state, now);
  if (!state) return { status: 400, text: 'This link is invalid or has expired. Go back to Prime Barber and try again.' };
  const to = (v: string) => ({ redirect: `${state.webBase}/app/?stripe=${v}` });
  if (q.error) return to('refresh');
  if (typeof q.code !== 'string' || !q.code) return to('refresh');
  try {
    const { account, livemode } = await exchangeCode(q.code, deps.stripe?.fetch);
    const mode = keyMode(process.env.STRIPE_CONNECT_SECRET_KEY);
    if (livemode !== null && mode && livemode !== (mode === 'live')) {
      console.error('[shop/stripe/oauth-return] client id / secret key mode mismatch');
      await deauthorizeIfUnlinked(account, deps);
      return to('refresh');
    }
    const token = signLinkToken({ shopId: state.shopId, userId: state.userId, account }, now);
    return { redirect: `${state.webBase}/app/?stripe_link=${encodeURIComponent(token)}` };
  } catch (e: any) {
    // Never log the code or tokens.
    console.error('[shop/stripe/oauth-return] failed:', e?.name, e?.status ?? '', e?.code ?? '');
    return to('refresh');
  }
}

/** Finish a link with the owner's JWT. 200 { status: 'return' | 'taken', chargesEnabled }. */
export async function stripeConnectConfirm(authorization: string | string[] | undefined, rawToken: unknown, deps: OauthDeps, now = Date.now()): Promise<Reply> {
  const r = await ownerShop(authorization, deps);
  if ('status' in r) return r;
  const { user, shop } = r;
  const link = verifyLinkToken(rawToken, now);
  if (!link) return { status: 400, body: { error: 'invalid-link' } };
  if (link.userId !== user.id || link.shopId !== shop.id) {
    await deauthorizeIfUnlinked(link.account, deps);
    return { status: 403, body: { error: 'wrong-owner' } };
  }
  const acct = link.account;
  try {
    const holder = await deps.shopIdByAccount(acct);
    if (holder && holder !== shop.id) return { status: 200, body: { status: 'taken' } };
    const current = shop.stripe_account_id;
    if (!current) {
      const stored = await deps.saveAccountId(shop.id, acct);
      if (stored !== acct) { await deauthorizeIfUnlinked(acct, deps); return { status: 200, body: { status: 'taken' } }; }
    } else if (current !== acct) {
      const old = await fetchAccountStatus(current, deps.stripe);
      const cardsOn = old.connected ? old.chargesEnabled : shop.stripe_charges_enabled;
      if (cardsOn || await deps.hasCardHistory(shop.id)) { await deauthorizeIfUnlinked(acct, deps); return { status: 200, body: { status: 'taken' } }; }
      await deps.audit(shop.id, 'stripe_oauth_replacing', { previous: current, account: acct });
      if (!(await deps.replaceAccountId(shop.id, current, acct))) { await deauthorizeIfUnlinked(acct, deps); return { status: 200, body: { status: 'taken' } }; }
    }
    const s = await fetchAccountStatus(acct, deps.stripe);
    await deps.setChargesEnabled(shop.id, s.chargesEnabled);
    if (current !== acct) {
      await deps.audit(shop.id, 'stripe_oauth_connected', { account: acct }).catch((e: any) =>
        console.error('[shop/stripe/oauth] audit failed:', e?.message || e));
    }
    return { status: 200, body: { status: 'return', chargesEnabled: s.chargesEnabled } };
  } catch (e: any) {
    console.error('[shop/stripe/connect-existing/confirm] failed:', e?.name, e?.status ?? '', e?.code ?? '');
    return { status: 502, body: { error: 'stripe-error' } };
  }
}
