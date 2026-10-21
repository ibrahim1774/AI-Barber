import type { VercelRequest, VercelResponse } from '@vercel/node';
import { endpoint, readBody, setCors } from '../../lib/bookings/http.js';
import { getPlan, livePlanDeps, refreshPlan } from '../../lib/ios/planFlow.js';

// Owner only (Authorization: Bearer <Supabase access token>).
// GET -> the shop's plan: { linked, tier, entitlements, active, expiresAt, takenDownAt, revoked }.
// POST { transactionId } -> right after an upgrade purchase: verify with Apple (the latest
// product), record it, link the purchase if the shop has none, then the GET body.
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
