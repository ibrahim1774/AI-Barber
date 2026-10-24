import type { VercelRequest, VercelResponse } from '@vercel/node';
import { endpoint, query, readBody, setCors } from '../../../lib/bookings/http.js';
import { runDomainStatus } from '../../../lib/ios/domainFlow.js';
import { liveDomainDeps } from '../../../lib/ios/domainLive.js';

// GET ?transactionId=… (or POST { transactionId }) → { domain, state, url?, paidUntil, autoRenew,
// sandbox?, canRetry?, vercel?: { verified, dnsOk, ssl } }. Per-IP read limit. lib/ios/domainFlow.ts.
const get = endpoint('GET', (req) => runDomainStatus(query(req, 'transactionId'), liveDomainDeps()), { rate: 'read', tag: 'ios/domain/status' });
const post = endpoint('POST', (req) => {
  const b = readBody(req) as { transactionId?: unknown } | undefined;
  return runDomainStatus(b && typeof b === 'object' ? b.transactionId : undefined, liveDomainDeps());
}, { rate: 'read', tag: 'ios/domain/status' });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'POST') return post(req, res);
  if (req.method === 'OPTIONS') {
    setCors(res, 'GET,POST');
    return res.status(200).end();
  }
  return get(req, res);
}
