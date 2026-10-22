import type { VercelRequest } from '@vercel/node';
import { endpoint, readBody } from '../../lib/bookings/http.js';
import { liveStoreDeps } from '../../lib/store/live.js';
import { postOrderSent } from '../../lib/store/publicFlow.js';

// POST { token, method } -> "I've sent it" on a manual payment rail.
export default endpoint('POST', (req: VercelRequest) => postOrderSent(readBody(req), liveStoreDeps()), { rate: 'write', tag: 'store/sent' });
