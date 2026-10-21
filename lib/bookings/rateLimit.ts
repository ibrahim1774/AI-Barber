// Rate limits for the public booking API (contract: 60 req/min reads, 10 req/min writes per
// IP), plus a per-shop cap on online bookings so rotating IPs can't flood one calendar.
//
// Writes (create, sent, manage cancel/reschedule) and the per-shop cap count in Supabase
// (006: ab_rate_hits + ab_rate_hit()), so they hold across every warm function instance.
// Reads stay in memory per instance. If the Supabase call fails, the limiter falls back to
// the in-memory store and logs: it fails open and never 500s a real customer.
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
  allow(ip: string, kind: RateKind): Promise<boolean>;
}

/**
 * Per-IP limiter: reads count in `readStore` (default in memory), writes in `writeStore`
 * (default: the same store as reads).
 */
export function makeRateLimiter(
  readStore: RateLimitStore = memoryStore(),
  now: () => number = Date.now,
  writeStore: RateLimitStore = readStore,
): RateLimiter {
  return {
    async allow(ip, kind) {
      const limit = kind === 'read' ? READ_LIMIT : WRITE_LIMIT;
      const store = kind === 'read' ? readStore : writeStore;
      return store.hit(`${kind}:${ip}`, limit, WINDOW_MS, now());
    },
  };
}

/** Cross-instance store (Supabase, in-memory fallback). The client is created on first use. */
const sharedStore: RateLimitStore = withFallback(supabaseRateStore(() => serviceClient()));

/** The limiter every /api/book/* handler uses: reads in memory, writes shared. */
export const publicLimiter = makeRateLimiter(memoryStore(), Date.now, sharedStore);

/** Per-shop online-booking cap (core FlowLimits.shopBooking). Fails open, never throws. */
export function shopBookingLimiter(store: RateLimitStore = sharedStore, now: () => number = Date.now) {
  const safe = withFallback(store);
  return {
    shopBooking: async (shopId: string) => safe.hit(`shop-book:${shopId}`, SHOP_BOOKING_LIMIT, SHOP_WINDOW_MS, now()),
  };
}

type Headers = Record<string, string | string[] | undefined>;

/** Client IP on Vercel: x-real-ip, else the first x-forwarded-for hop (both set by Vercel's edge). */
export function clientIp(headers: Headers | undefined): string {
  const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const real = pick(headers?.['x-real-ip'])?.trim();
  if (real) return real;
  const xff = pick(headers?.['x-forwarded-for'])?.split(',')[0]?.trim();
  return xff || 'unknown';
}
