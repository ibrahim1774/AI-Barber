import crypto from 'node:crypto';
import {
  SITE_ORIGIN, STRIPE_TIMEOUT_MS, StripeApiError, fetchAccountStatus, ownerShop,
  type FetchLike, type OwnerStripeDeps,
} from './payments.js';

/**
 * "Connect an existing Stripe account" (Stripe Connect OAuth, Standard accounts).
 *
 * The client id (STRIPE_CONNECT_CLIENT_ID, a ca_ id) must be the same mode as STRIPE_CONNECT_SECRET_KEY
 * (the key stripeRequest uses): a test ca_ id with sk_test_..., a live ca_ id with sk_live_....
 * Redirect URI to register in the Connect settings of each mode: `${oauthOrigin()}/api/shop/stripe/oauth-return`.
 */

export const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;
const STATE_LABEL = 'pb-stripe-oauth-state-v1';

/** The origin Stripe redirects back to (this API). Fixed, never taken from request headers. */
export const oauthOrigin = () => process.env.STRIPE_OAUTH_REDIRECT_ORIGIN || SITE_ORIGIN;
export const oauthRedirectUri = () => `${oauthOrigin()}/api/shop/stripe/oauth-return`;

export interface OauthState { shopId: string; userId: string; webBase: string; exp: number; nonce: string }

const b64u = (b: Buffer | string) => Buffer.from(b).toString('base64url');

function stateKey(): Buffer {
  const sk = process.env.STRIPE_CONNECT_SECRET_KEY;
  if (!sk) throw new StripeApiError('missing STRIPE_CONNECT_SECRET_KEY', 500, 'config');
  return crypto.createHmac('sha256', sk).update(STATE_LABEL).digest();
}

export function signOauthState(s: Omit<OauthState, 'exp' | 'nonce'>, now = Date.now()): string {
  const payload: OauthState = { ...s, exp: now + OAUTH_STATE_TTL_MS, nonce: crypto.randomBytes(12).toString('hex') };
  const p = b64u(JSON.stringify(payload));
  return `${p}.${b64u(crypto.createHmac('sha256', stateKey()).update(p).digest())}`;
}

export function verifyOauthState(token: unknown, now = Date.now()): OauthState | null {
  if (typeof token !== 'string' || token.length > 2048) return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  try {
    const want = crypto.createHmac('sha256', stateKey()).update(parts[0]).digest();
    const got = Buffer.from(parts[1], 'base64url');
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
    const s = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    if (!s || typeof s.shopId !== 'string' || typeof s.userId !== 'string' || typeof s.webBase !== 'string'
      || typeof s.nonce !== 'string' || typeof s.exp !== 'number' || s.exp < now) return null;
    return s as OauthState;
  } catch { return null; }
}

export interface OauthDeps extends OwnerStripeDeps {
  /** The shop (if any) that already stores this connected account id. */
  shopIdByAccount(accountId: string): Promise<string | null>;
  /** Swap the stored id only while it still equals `oldId`; true when the row changed. */
  replaceAccountId(shopId: string, oldId: string, newId: string): Promise<boolean>;
}

type Reply = { status: number; body: object };

/** POST /api/shop/stripe/connect-existing -> { url } */
export async function stripeConnectExisting(authorization: string | string[] | undefined, deps: OwnerStripeDeps): Promise<Reply> {
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

async function exchangeCode(code: string, f?: FetchLike): Promise<string> {
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
  return json.stripe_user_id;
}

/** GET /api/shop/stripe/oauth-return?code&state (or &error) */
export async function stripeOauthReturn(q: { code?: unknown; state?: unknown; error?: unknown }, deps: OauthDeps): Promise<Redirect> {
  const state = verifyOauthState(q.state);
  if (!state) return { status: 400, text: 'This link is invalid or has expired. Go back to Prime Barber and try again.' };
  const to = (v: string) => ({ redirect: `${state.webBase}/app/?stripe=${v}` });
  if (q.error) return to('refresh');
  if (typeof q.code !== 'string' || !q.code) return to('refresh');
  try {
    const acct = await exchangeCode(q.code, deps.stripe?.fetch);
    const shop = await deps.shopForOwner(state.userId);
    if (!shop || shop.owner_id !== state.userId || shop.id !== state.shopId) {
      return { status: 400, text: 'This link is invalid or has expired. Go back to Prime Barber and try again.' };
    }
    const holder = await deps.shopIdByAccount(acct);
    if (holder && holder !== shop.id) return to('taken');
    const current = shop.stripe_account_id;
    if (!current) {
      const stored = await deps.saveAccountId(shop.id, acct);
      if (stored !== acct) return to('taken');
    } else if (current !== acct) {
      const old = await fetchAccountStatus(current, deps.stripe);
      const cardsOn = old.connected ? old.chargesEnabled : shop.stripe_charges_enabled;
      if (cardsOn) return to('taken');
      if (!(await deps.replaceAccountId(shop.id, current, acct))) return to('taken');
    }
    const s = await fetchAccountStatus(acct, deps.stripe);
    await deps.setChargesEnabled(shop.id, s.chargesEnabled);
    await deps.audit(shop.id, 'stripe_oauth_connected', { account: acct }).catch((e: any) =>
      console.error('[shop/stripe/oauth-return] audit failed:', e?.message || e));
    return to('return');
  } catch (e: any) {
    // Never log the code or tokens.
    console.error('[shop/stripe/oauth-return] failed:', e?.name, e?.status ?? '', e?.code ?? '');
    return to('refresh');
  }
}
