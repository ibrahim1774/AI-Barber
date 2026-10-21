// Thin request/response helpers shared by the api/book/* and api/shop/* handlers.
import type { VercelRequest, VercelResponse } from '@vercel/node';
import type { FlowResult } from './core.js';
import { clientIp, publicLimiter, type RateKind, type RateLimiter } from './rateLimit.js';

export function setCors(res: VercelResponse, methods: string) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', `OPTIONS,${methods}`);
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization, X-Requested-With, Accept, Content-Type, Content-Length, Date',
  );
}

/** Parsed JSON body; `undefined` when it is malformed (@vercel/node's lazy getter throws). */
export function readBody(req: VercelRequest): unknown {
  let body: unknown;
  try {
    body = req.body;
  } catch {
    return undefined;
  }
  if (typeof body === 'string') {
    try {
      return JSON.parse(body);
    } catch {
      return undefined;
    }
  }
  return body;
}

/** First value of a query parameter. */
export function query(req: VercelRequest, name: string): string | undefined {
  const v = req.query?.[name];
  return Array.isArray(v) ? v[0] : v;
}

export function send(res: VercelResponse, r: FlowResult) {
  for (const [k, v] of Object.entries(r.headers ?? {})) res.setHeader(k, v);
  if (r.contentType) {
    res.setHeader('Content-Type', r.contentType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.status(r.status).send(r.body as string);
  }
  res.setHeader('Cache-Control', 'no-store');
  return res.status(r.status).json(r.body);
}

type Handler = (req: VercelRequest, res: VercelResponse) => Promise<unknown>;

/**
 * Wraps a handler with CORS, method check, optional per-IP rate limit and a catch-all 500.
 * `run` returns the flow result.
 */
export function endpoint(
  method: 'GET' | 'POST',
  run: (req: VercelRequest) => Promise<FlowResult>,
  opts: { rate?: RateKind; limiter?: RateLimiter; tag: string },
): Handler {
  return async (req, res) => {
    setCors(res, method);
    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== method) return res.status(405).json({ error: 'method-not-allowed' });
    if (opts.rate) {
      const limiter = opts.limiter ?? publicLimiter;
      if (!limiter.allow(clientIp(req.headers as any), opts.rate)) {
        res.setHeader('Retry-After', '60');
        return res.status(429).json({ error: 'rate-limited' });
      }
    }
    try {
      return send(res, await run(req));
    } catch (e: any) {
      console.error(`[${opts.tag}] handler error:`, e?.message || e);
      return res.status(500).json({ error: 'server-error' });
    }
  };
}

/** The :id of /api/shop/appointments/:id/(cancel|reschedule|mark): Vercel's [id] param, else parsed from the URL. */
export function appointmentIdParam(req: VercelRequest): string | undefined {
  const q = query(req, 'id');
  if (q) return q;
  const m = /\/api\/shop\/appointments\/([^/?#]+)\//.exec(req.url ?? '');
  return m ? decodeURIComponent(m[1]) : undefined;
}
