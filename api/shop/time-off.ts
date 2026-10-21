import type { VercelRequest } from '@vercel/node';
import { endpoint, readBody } from '../../lib/bookings/http.js';
import { liveDeps } from '../../lib/bookings/live.js';
import { createTimeOff } from '../../lib/bookings/ownerFlow.js';

// POST (owner JWT) -> block time; lists (and optionally cancels, with refund + email) conflicting bookings.
export default endpoint('POST', (req: VercelRequest) => createTimeOff(req.headers.authorization, readBody(req), liveDeps()), { tag: 'shop/time-off' });
