import type { VercelRequest } from '@vercel/node';
import { appointmentIdParam, endpoint } from '../../../../lib/bookings/http.js';
import { liveDeps } from '../../../../lib/bookings/live.js';
import { cancelOwnerAppointment } from '../../../../lib/bookings/ownerFlow.js';

// POST (owner JWT) /api/shop/appointments/:id/cancel -> cancelled_by 'shop', full refund of what was paid, email.
export default endpoint('POST', (req: VercelRequest) => cancelOwnerAppointment(req.headers.authorization, appointmentIdParam(req), liveDeps()), { tag: 'shop/appointments/[id]/cancel' });
