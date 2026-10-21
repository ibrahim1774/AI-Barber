import type { VercelRequest } from '@vercel/node';
import { endpoint, readBody } from '../../lib/bookings/http.js';
import { liveDeps } from '../../lib/bookings/live.js';
import { createAppointment } from '../../lib/bookings/publicFlow.js';

// POST a booking from the public page (201, 409 slot-taken/duplicate, 423 paused).
export default endpoint('POST', (req: VercelRequest) => createAppointment(readBody(req), liveDeps()), { rate: 'write', tag: 'book/appointments' });
