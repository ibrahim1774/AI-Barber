// Request helpers for api/shop/orders/*.
import type { VercelRequest } from '@vercel/node';
import { query } from '../bookings/http.js';

/** The :id of /api/shop/orders/:id/(mark|refund): Vercel's [id] param, else parsed from the URL. */
export function orderIdParam(req: VercelRequest): string | undefined {
  const q = query(req, 'id');
  if (q) return q;
  const m = /\/api\/shop\/orders\/([^/?#]+)\//.exec(req.url ?? '');
  if (!m) return undefined;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return undefined;
  }
}
