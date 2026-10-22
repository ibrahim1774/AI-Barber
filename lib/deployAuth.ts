// Who may deploy to which slug through /api/deploy-site.
//
// Before this, /api/deploy-site took { siteId, html, deployedUrl } from anyone and deployed
// the HTML to that slug's Vercel project (and, for an app site, rewrote its stored copy).
// Slugs are public (they are the site URL), so anyone could replace any customer's site.
//
// The target is always derived here, never taken from the body as is:
// - slugify(body.siteId) is the requested slug.
// - body.deployedUrl is only a hint: its *.vercel.app label is used when it is an
//   app (iOS) slug that the caller owns (or the caller is the admin). An app site renamed
//   on the web keeps its bound slug this way. A hint the caller does not own is ignored.
//
// Proof, strongest first:
// - Admin: Supabase bearer whose user is ADMIN_EMAIL (lib/admin/auth.ts). Any slug.
// - App slug (ios_purchases.site_slug): only a Supabase bearer whose user is
//   ios_purchases.user_id. A checkout session never counts for an app slug.
// - Web slug:
//   - a paid aibarber Stripe Checkout Session for this slug (the first publish after
//     checkout, and the /recover replay), created within CHECKOUT_PROOF_MAX_AGE_MS; or
//   - a valid Supabase bearer, unless another account's `sites` row already claims this
//     slug and the caller's does not. NOTE: `sites` rows are user-writable under RLS, so this
//     is "signed in", not proof of ownership. See the hotfix report for the options.
//
// Every lookup fails closed (503): an outage must not turn into an unauthenticated deploy.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { ADMIN_EMAIL } from './admin/auth.js';
import { slugify } from './publishSite.js';
import { supabasePurchases, type PurchaseRow } from './ios/purchases.js';
import { withTimeout } from './ios/timeout.js';

export const CHECKOUT_PROOF_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const LOOKUP_TIMEOUT_MS = 5000;

export interface DeployUser {
  id: string;
  email: string | null;
}

export interface CheckoutProof {
  paid: boolean;
  /** metadata.siteId, else client_reference_id. */
  siteId: string | null;
  /** metadata.app; null when absent (older sessions). */
  app: string | null;
  /** Unix seconds. */
  created: number;
}

export interface DeployAuthDeps {
  /** The token's user; null when the token is not valid. Throws on an outage. */
  userOf(token: string): Promise<DeployUser | null>;
  /** The iOS purchase bound to this slug, or null. Throws on an outage. */
  findBySlug(slug: string): Promise<PurchaseRow | null>;
  /** The Checkout Session, or null when Stripe does not know it. Throws on an outage. */
  checkoutSession(sessionId: string): Promise<CheckoutProof | null>;
  /** User ids of `sites` rows whose deployed_url is https://{slug}.vercel.app. Throws on an outage. */
  webClaimants(slug: string): Promise<string[]>;
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
    return label && /^[a-z0-9-]+$/.test(label) ? slugify(label) || null : null;
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

  // The deployedUrl hint: only to an app slug the caller may deploy to.
  if (labelRow && (isAdmin || owns(labelRow))) {
    return { ok: true, target: label!, row: labelRow, actor: isAdmin ? 'admin' : 'app-owner', userId: user!.id };
  }
  if (labelRow) {
    console.warn(`[Deploy Site] ${shopSlug}: ignoring deployedUrl hint ${label} (caller does not own it)`);
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
    if (
      proof && proof.paid && fresh &&
      (proof.app == null || proof.app === 'aibarber') &&
      slugify(proof.siteId || '') === shopSlug
    ) {
      return { ok: true, target: shopSlug, row: null, actor: 'checkout', userId: user?.id ?? null };
    }
    console.warn(`[Deploy Site] ${shopSlug}: checkout session does not authorise this slug`);
  }

  if (user) {
    let claimants: string[];
    try {
      claimants = await withTimeout(deps.webClaimants(shopSlug), ms, 'sites claim lookup');
    } catch (e: any) {
      console.error(`[Deploy Site] ${shopSlug}: sites claim lookup failed (refusing):`, e?.message || e);
      return unavailable;
    }
    if (claimants.length > 0 && !claimants.includes(user.id)) {
      console.warn(`[Deploy Site] ${shopSlug}: claimed by another account; refusing ${user.id}`);
      return deny(403, 'not-authorized');
    }
    return { ok: true, target: shopSlug, row: null, actor: 'web-user', userId: user.id };
  }

  // A checkout that does not match (another slug, unpaid, older than the proof window).
  return sessionId ? deny(403, 'checkout-not-valid') : deny(401, 'sign-in-required');
}

/** Live dependencies: Supabase (service role) and Stripe. Clients are created on first use. */
export function liveDeployAuthDeps(): DeployAuthDeps {
  let sb: SupabaseClient | undefined;
  const db = () => (sb ??= createClient(
    (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL)!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  ));
  let repo: ReturnType<typeof supabasePurchases> | undefined;
  return {
    async userOf(token) {
      const { data, error } = await db().auth.getUser(token);
      if (error) {
        // An invalid or expired token is a 4xx from GoTrue; anything else is an outage.
        const status = (error as any).status;
        if (typeof status === 'number' && status >= 400 && status < 500) return null;
        throw new Error(`auth.getUser failed: ${error.message}`);
      }
      return data?.user ? { id: data.user.id, email: data.user.email?.toLowerCase() ?? null } : null;
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
        siteId,
        app: typeof s?.metadata?.app === 'string' ? s.metadata.app : null,
        created: typeof s?.created === 'number' ? s.created : 0,
      };
    },
    async webClaimants(slug) {
      const url = `https://${slug}.vercel.app`;
      const { data, error } = await db().from('sites').select('user_id').in('deployed_url', [url, `${url}/`]);
      if (error) throw new Error(`sites claim lookup failed: ${error.message}`);
      return [...new Set((data || []).map((r: any) => r.user_id).filter((u: unknown): u is string => typeof u === 'string'))];
    },
    now: () => Date.now(),
  };
}
