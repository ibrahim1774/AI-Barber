import type { VercelRequest } from '@vercel/node';
import { appointmentIdParam, endpoint, readBody } from '../../../../lib/bookings/http.js';
import { liveDeps } from '../../../../lib/bookings/live.js';
import { markOwnerAppointment } from '../../../../lib/bookings/ownerFlow.js';

// POST (owner JWT) /api/shop/appointments/:id/mark { action: 'paid' | 'done' | 'no_show' } -> { appointment }.
export default endpoint('POST', (req: VercelRequest) => markOwnerAppointment(req.headers.authorization, appointmentIdParam(req), readBody(req), liveDeps()), { tag: 'shop/appointments/[id]/mark' });
