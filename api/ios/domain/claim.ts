import { endpoint, readBody } from '../../../lib/bookings/http.js';
import { clientIp } from '../../../lib/bookings/rateLimit.js';
import { runDomainClaim } from '../../../lib/ios/domainFlow.js';
import { liveDomainDeps } from '../../../lib/ios/domainLive.js';

// POST { transactionId (domain subscription), siteTransactionId (the site's plan), domain }
// [Authorization: Bearer <Supabase access token> optional, the signed-in ownership proof]
// → 200 live | 202 in progress | 409 refused or failed (status body). Idempotent: call again
// with the same domain to resume. 10/min per IP and per transaction (lib/ios/domainFlow.ts).
export const config = { maxDuration: 300 };

export default endpoint('POST', (req) => runDomainClaim(readBody(req), req.headers.authorization, liveDomainDeps(), clientIp(req.headers as any)), {
  tag: 'ios/domain/claim',
});
