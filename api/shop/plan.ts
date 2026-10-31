import type { VercelRequest, VercelResponse } from '@vercel/node';
import { endpoint, readBody, setCors } from '../../lib/bookings/http.js';
import { getPlan, livePlanDeps, refreshPlan } from '../../lib/ios/planFlow.js';

// Owner only (Authorization: Bearer <Supabase access token>).
// GET -> the plan (the shop's purchase, or with no shop the caller's own newest active purchase): { linked, tier, entitlements, active, expiresAt,
// takenDownAt, revoked, purchaseAccount: 'self'|'other'|null }.
// POST { transactionId } -> right after a purchase or upgrade: verify with Apple (the latest
// product), record it, link (or relink) the shop to it when Apple says it is active (409
// purchase-in-use under setup's rules), then the GET body. Per-user write limit (429).
const get = endpoint('GET', (req) => getPlan(req.headers.authorization, livePlanDeps()), { tag: 'shop/plan' });
const post = endpoint('POST', (req) => refreshPlan(req.headers.authorization, readBody(req), livePlanDeps()), { tag: 'shop/plan' });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'POST') return post(req, res);
  if (req.method === 'OPTIONS') {
    setCors(res, 'GET,POST');
    return res.status(200).end();
  }
  return get(req, res);
}
