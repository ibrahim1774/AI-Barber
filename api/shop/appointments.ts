import type { VercelRequest } from '@vercel/node';
import { endpoint, readBody } from '../../lib/bookings/http.js';
import { liveDeps } from '../../lib/bookings/live.js';
import { createOwnerAppointment } from '../../lib/bookings/ownerFlow.js';

// POST (owner JWT) -> walk-in / owner booking. Skips notice and lead days; the DB guard still applies.
export default endpoint('POST', (req: VercelRequest) => createOwnerAppointment(req.headers.authorization, readBody(req), liveDeps()), { tag: 'shop/appointments' });
