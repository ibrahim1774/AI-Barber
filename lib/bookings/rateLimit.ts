// Rate limits for the public booking API (contract: 60 req/min reads, 10 req/min writes per
// IP), plus a per-shop cap on online bookings so rotating IPs can't flood one calendar.
//
// Writes (create, sent, manage cancel/reschedule) and the per-shop cap count in Supabase
// (006: ab_rate_hits + ab_rate_hit()), so they hold across every warm function instance.
// Reads stay in memory per instance. If the Supabase call fails, the limiter falls back to
// the in-memory store and logs: it fails open and never 500s a real customer.
import { isIP } from 'node:net';
import type { SupabaseClient } from '@supabase/supabase-js';
import { serviceClient } from './repo.js';

export const READ_LIMIT = 60;
export const WRITE_LIMIT = 10;
const WINDOW_MS = 60_000;
/** Online bookings per shop per hour, across all IPs. */
export const SHOP_BOOKING_LIMIT = 40;
export const SHOP_WINDOW_MS = 3_600_000;
const MAX_KEYS = 10_000;

export interface RateLimitStore {
  /** Count one hit for `key`; true when it is within `limit` for the current window. May throw. */
  hit(key: string, limit: number, windowMs: number, now: number): boolean | Promise<boolean>;
}

export function memoryStore(): RateLimitStore {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    hit(key, limit, windowMs, now) {
      let w = windows.get(key);
      if (!w || now - w.start >= windowMs) {
        if (windows.size >= MAX_KEYS) {
          for (const [k, v] of windows) if (now - v.start >= windowMs) windows.delete(k);
          if (windows.size >= MAX_KEYS) windows.clear();
        }
        w = { start: now, count: 0 };
        windows.set(key, w);
      }
      w.count += 1;
      return w.count <= limit;
    },
  };
}

/**
 * Shared counter in Supabase: ab_rate_hit(key, window seconds, max) does an atomic
 * insert ... on conflict do update set hits = hits + 1 in a fixed window aligned to the
 * epoch, and returns hits <= max. Service role only (006 revokes execute from everyone else).
 * `client` may be a factory so the service client is created on first use.
 */
export function supabaseRateStore(client?: SupabaseClient | (() => SupabaseClient)): RateLimitStore {
  let sb: SupabaseClient | undefined = typeof client === 'function' ? undefined : client;
  const db = () => (sb ??= typeof client === 'function' ? client() : serviceClient());
  return {
    async hit(key, limit, windowMs) {
      const { data, error } = await db().rpc('ab_rate_hit', {
        p_key: key,
        p_window_s: Math.max(1, Math.round(windowMs / 1000)),
        p_max: limit,
      });
      if (error) throw new Error(`ab_rate_hit failed: ${error.message ?? 'unknown'}`);
      if (typeof data !== 'boolean') throw new Error('ab_rate_hit returned no boolean');
      return data;
    },
  };
}

/** `primary`, falling back to `fallback` (and logging) whenever it throws: fail open. */
export function withFallback(
  primary: RateLimitStore,
  fallback: RateLimitStore = memoryStore(),
  log: (msg: string) => void = (m) => console.error(m),
): RateLimitStore {
  return {
    async hit(key, limit, windowMs, now) {
      try {
        return await primary.hit(key, limit, windowMs, now);
      } catch (e: any) {
        log(`[bookings/rateLimit] shared store failed, using the in-memory limit: ${e?.message || e}`);
        return fallback.hit(key, limit, windowMs, now);
      }
    },
  };
}

export type RateKind = 'read' | 'write';

export interface RateLimiter {
  /** `subject`: a validated IP literal (clientIp) or a server-derived id (a verified user id). */
  allow(subject: string, kind: RateKind): Promise<boolean>;
}

/** Limiter scopes: a fixed, server-chosen namespace per limiter, never from the request. */
export type RateScope = 'public' | 'ios' | 'deploy' | 'user' | 'signup' | 'signupEmail' | 'transfer';

/**
 * Limiter keyed `${scope}:${kind}:${subject}`: reads count in `readStore` (default in memory),
 * writes in `writeStore` (default: the same store as reads). The scope and kind are trusted and
 * colon-free and come first, so no subject (an IP, even a forged header value; clientIp only
 * passes validated literals anyway) can land in another limiter's or kind's bucket.
 */
export function makeRateLimiter(
  readStore: RateLimitStore = memoryStore(),
  now: () => number = Date.now,
  writeStore: RateLimitStore = readStore,
  limits: { read: number; write: number } = { read: READ_LIMIT, write: WRITE_LIMIT },
  scope: RateScope = 'public',
): RateLimiter {
  return {
    async allow(subject, kind) {
      const limit = kind === 'read' ? limits.read : limits.write;
      const store = kind === 'read' ? readStore : writeStore;
      return store.hit(`${scope}:${kind}:${subject}`, limit, WINDOW_MS, now());
    },
  };
}

/** Cross-instance store (Supabase, in-memory fallback). The client is created on first use. */
const sharedStore: RateLimitStore = withFallback(supabaseRateStore(() => serviceClient()));

/** The limiter every /api/book/* and /api/store/* handler uses, per IP: reads in memory, writes shared. */
export const publicLimiter = makeRateLimiter(memoryStore(), Date.now, sharedStore, { read: READ_LIMIT, write: WRITE_LIMIT }, 'public');

/** /api/deploy-site, per IP (same limits as the public pages, its own buckets). */
export const deployLimiter = makeRateLimiter(memoryStore(), Date.now, sharedStore, { read: READ_LIMIT, write: WRITE_LIMIT }, 'deploy');

/** Per signed-in user (subject = the verified Supabase user id): /api/shop/plan and setup's Apple verify. */
export const userLimiter = makeRateLimiter(memoryStore(), Date.now, sharedStore, { read: READ_LIMIT, write: WRITE_LIMIT }, 'user');

/**
 * The iOS endpoints (/api/ios/site lookups = read, /api/ios/publish = write), per IP, shared
 * across instances (e2e M9). Each call costs up to two App Store Server API requests, so a flood
 * would exhaust Apple's quota and real publishes would get 503. Looser than the booking limits:
 * phones on one carrier NAT share an address. Keys are prefixed so they never share a bucket
 * with the booking pages.
 */
export const IOS_READ_LIMIT = 60;
export const IOS_WRITE_LIMIT = 20;
export const iosLimiter = makeRateLimiter(sharedStore, Date.now, sharedStore, { read: IOS_READ_LIMIT, write: IOS_WRITE_LIMIT }, 'ios');

/**
 * POST /api/ios/signup (account creation): per IP, and per email (subject = sha256 of the lowercased
 * address, so no address is ever a limiter key). Writes are shared across instances.
 */
export const SIGNUP_IP_LIMIT = 10;
export const SIGNUP_EMAIL_LIMIT = 4;
export const signupIpLimiter = makeRateLimiter(sharedStore, Date.now, sharedStore, { read: SIGNUP_IP_LIMIT, write: SIGNUP_IP_LIMIT }, 'signup');
export const signupEmailLimiter = makeRateLimiter(sharedStore, Date.now, sharedStore, { read: SIGNUP_EMAIL_LIMIT, write: SIGNUP_EMAIL_LIMIT }, 'signupEmail');

/** Per-shop online-booking cap (core FlowLimits.shopBooking). Fails open, never throws. */
export function shopBookingLimiter(store: RateLimitStore = sharedStore, now: () => number = Date.now) {
  const safe = withFallback(store);
  return {
    shopBooking: async (shopId: string) => safe.hit(`shop-book:${shopId}`, SHOP_BOOKING_LIMIT, SHOP_WINDOW_MS, now()),
  };
}

type Headers = Record<string, string | string[] | undefined>;

/**
 * Client IP on Vercel: x-real-ip, else the first x-forwarded-for hop (both set by Vercel's edge).
 * x-vercel-forwarded-for is not read: it may be client-sent on a direct request. Whether a barber
 * site's proxy (external rewrite) preserves the visitor's address is a live-site check
 * (2026-10-22-subpages server-report); it decides whether this order changes.
 */
export function clientIp(headers: Headers | undefined): string {
  const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const real = pick(headers?.['x-real-ip'])?.trim();
  if (real) return ipLiteral(real);
  const xff = pick(headers?.['x-forwarded-for'])?.split(',')[0]?.trim();
  return xff ? ipLiteral(xff) : 'unknown';
}

/**
 * Only a valid IPv4 / IPv6 literal is a limiter subject (IPv6 lower-cased); anything else (a
 * forged header such as `write:ios:1.2.3.4`) shares the one fixed 'unknown' bucket.
 */
function ipLiteral(v: string): string {
  if (v.length > 64) return 'unknown';
  const kind = isIP(v);
  if (kind === 4) return v;
  if (kind === 6) return v.toLowerCase();
  return 'unknown';
}
