// Pure helpers for the web app's Stripe subscriptions (www.aibarber.org/app). Nothing here touches
// the existing checkout or webhook; every object we create is tagged metadata.app = 'aibarber-app'.
import crypto from 'crypto';

export const WEB_APP_TAG = 'aibarber-app';
export const TIERS = ['website', 'bookings', 'store'] as const;
export const INTERVALS = ['month', 'year'] as const;
export type Tier = (typeof TIERS)[number];
export type Interval = (typeof INTERVALS)[number];

// Same prices as the iOS app, in cents.
export const PRICES: Record<Tier, Record<Interval, number>> = {
  website: { month: 1999, year: 19199 },
  bookings: { month: 2499, year: 23999 },
  store: { month: 3999, year: 37999 },
};

export const PRICE_ENV = (tier: Tier, interval: Interval) => `STRIPE_WEBAPP_PRICE_${tier.toUpperCase()}_${interval.toUpperCase()}`;

export function isTier(v: unknown): v is Tier { return typeof v === 'string' && (TIERS as readonly string[]).includes(v); }
export function isInterval(v: unknown): v is Interval { return typeof v === 'string' && (INTERVALS as readonly string[]).includes(v); }

export function priceIdFor(tier: Tier, interval: Interval, env: Record<string, string | undefined>): string | null {
  return env[PRICE_ENV(tier, interval)] || null;
}

export function tierForPriceId(priceId: string, env: Record<string, string | undefined>): { tier: Tier; interval: Interval } | null {
  for (const tier of TIERS) for (const interval of INTERVALS) if (priceIdFor(tier, interval, env) === priceId) return { tier, interval };
  return null;
}

/** A subscription counts as paid while Stripe says active, trialing or past_due (retries still running). */
export const isEntitledStatus = (s: string) => s === 'active' || s === 'trialing' || s === 'past_due';

export function verifyStripeSignature(raw: string, header: string | undefined, secret: string, nowSec = Math.floor(Date.now() / 1000), toleranceSec = 300): boolean {
  if (!header || !secret) return false;
  const parts = header.split(',').map((p) => p.split('='));
  const t = parts.find((p) => p[0] === 't')?.[1];
  const v1s = parts.filter((p) => p[0] === 'v1').map((p) => p[1]);
  const ts = parseInt(t ?? '', 10);
  if (!t || v1s.length === 0 || !Number.isFinite(ts) || Math.abs(nowSec - ts) > toleranceSec) return false;
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(`${t}.${raw}`, 'utf8').digest('hex'));
  return v1s.some((v) => { const b = Buffer.from(v); return b.length === expected.length && crypto.timingSafeEqual(b, expected); });
}

export interface EntitlementRow {
  stripe_subscription_id: string;
  stripe_customer_id: string;
  user_id: string | null;
  site_slug: string | null;
  tier: Tier;
  billing_interval: Interval;
  status: string;
  environment: 'live' | 'test';
  current_period_end: string | null;
  cancel_at_period_end: boolean;
}

/** Which Stripe mode a secret key belongs to. */
export const keyMode = (key: string | undefined): 'live' | 'test' | null => (key?.startsWith('sk_live_') ? 'live' : key?.startsWith('sk_test_') || key?.startsWith('rk_test_') ? 'test' : key?.startsWith('rk_live_') ? 'live' : null);

/**
 * The row for a (freshly fetched) subscription, or null when it is not ours (no tag) so other flows are
 * never touched. A tagged subscription on an unknown price is still stored, as status 'invalid_price'
 * (not entitled), so a price switch or env change can never leave an old row paid forever.
 */
export function rowFromSubscription(sub: any, livemode: boolean, env: Record<string, string | undefined>, deleted = false): EntitlementRow | null {
  if (!sub || sub.metadata?.app !== WEB_APP_TAG || typeof sub.id !== 'string') return null;
  const item = sub.items?.data?.[0];
  const priceId = item?.price?.id;
  const match = priceId ? tierForPriceId(priceId, env) : null;
  const customer = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  if (!customer) return null;
  const end = item?.current_period_end ?? sub.current_period_end;
  const metaTier = isTier(sub.metadata?.tier) ? sub.metadata.tier : 'website';
  const rawInterval = item?.price?.recurring?.interval;
  return {
    stripe_subscription_id: sub.id,
    stripe_customer_id: customer,
    user_id: sub.metadata?.user_id || null,
    site_slug: sub.metadata?.site_slug || null,
    tier: match ? match.tier : metaTier,
    billing_interval: match ? match.interval : (isInterval(rawInterval) ? rawInterval : 'month'),
    status: deleted ? 'canceled' : match ? String(sub.status) : 'invalid_price',
    environment: livemode ? 'live' : 'test',
    current_period_end: typeof end === 'number' ? new Date(end * 1000).toISOString() : null,
    cancel_at_period_end: !!sub.cancel_at_period_end,
  };
}
