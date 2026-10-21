// Per-IP rate limits for the public booking API (contract: 60 req/min reads, 10 req/min
// writes). Fixed one-minute windows.
//
// The default store is in memory, so on Vercel the limit holds per warm function instance,
// not globally. That stops a single client hammering one instance (the common abuse case);
// a shared store (e.g. Redis/KV) can be dropped in behind RateLimitStore later.

export const READ_LIMIT = 60;
export const WRITE_LIMIT = 10;
const WINDOW_MS = 60_000;
const MAX_KEYS = 10_000;

export interface RateLimitStore {
  /** Count one hit for `key`; true when it is within `limit` for the current window. */
  hit(key: string, limit: number, windowMs: number, now: number): boolean;
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

export type RateKind = 'read' | 'write';

export interface RateLimiter {
  allow(ip: string, kind: RateKind): boolean;
}

export function makeRateLimiter(store: RateLimitStore = memoryStore(), now: () => number = Date.now): RateLimiter {
  return {
    allow(ip, kind) {
      const limit = kind === 'read' ? READ_LIMIT : WRITE_LIMIT;
      return store.hit(`${kind}:${ip}`, limit, WINDOW_MS, now());
    },
  };
}

/** Shared per-instance limiter for every /api/book/* handler. */
export const publicLimiter = makeRateLimiter();

type Headers = Record<string, string | string[] | undefined>;

/** Client IP on Vercel: x-real-ip, else the first x-forwarded-for hop (both set by Vercel's edge). */
export function clientIp(headers: Headers | undefined): string {
  const pick = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const real = pick(headers?.['x-real-ip'])?.trim();
  if (real) return real;
  const xff = pick(headers?.['x-forwarded-for'])?.split(',')[0]?.trim();
  return xff || 'unknown';
}
