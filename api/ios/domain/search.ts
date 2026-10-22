import { endpoint, readBody } from '../../../lib/bookings/http.js';
import { publicLimiter } from '../../../lib/bookings/rateLimit.js';
import { runDomainSearch } from '../../../lib/ios/domainFlow.js';
import { liveVercelDomains } from '../../../lib/ios/vercelDomains.js';

// POST { transactionId?, q } → { results: [{ domain, available, eligible }] } (.com only).
// Never asks Apple (the transactionId is only a hashed rate-limit key). Per-IP write limit
// (10/min, shared across instances) plus a per-transaction one. lib/ios/domainFlow.ts.
export default endpoint('POST', (req) => runDomainSearch(readBody(req), { vercel: liveVercelDomains(), limiter: publicLimiter }), {
  rate: 'write',
  tag: 'ios/domain/search',
});
