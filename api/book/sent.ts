import type { VercelRequest } from '@vercel/node';
import { endpoint, readBody } from '../../lib/bookings/http.js';
import { liveDeps } from '../../lib/bookings/live.js';
import { postSent } from '../../lib/bookings/publicFlow.js';

// POST { token, method } -> "I've sent it" on a manual payment rail.
export default endpoint('POST', (req: VercelRequest) => postSent(readBody(req), liveDeps()), { rate: 'write', tag: 'book/sent' });
