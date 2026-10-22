import { endpoint, readBody } from '../../../lib/bookings/http.js';
import { clientIp, publicLimiter } from '../../../lib/bookings/rateLimit.js';
import { runDomainSearch } from '../../../lib/ios/domainFlow.js';
import { liveVercelDomains } from '../../../lib/ios/vercelDomains.js';

// POST { transactionId?, q } → { results: [{ domain, available, eligible }] } (.com only).
// Never asks Apple (the transactionId is only a hashed rate-limit key). 10/min per IP and
// 10/min per transaction, shared across instances (lib/ios/domainFlow.ts).
export default endpoint('POST', (req) => runDomainSearch(readBody(req), { vercel: liveVercelDomains(), limiter: publicLimiter }, clientIp(req.headers as any)), {
  tag: 'ios/domain/search',
});
