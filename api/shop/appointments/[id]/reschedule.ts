import type { VercelRequest } from '@vercel/node';
import { appointmentIdParam, endpoint, readBody } from '../../../../lib/bookings/http.js';
import { liveDeps } from '../../../../lib/bookings/live.js';
import { rescheduleOwnerAppointment } from '../../../../lib/bookings/ownerFlow.js';

// POST (owner JWT) /api/shop/appointments/:id/reschedule { start, memberId? } -> moves it in place, emails the customer.
export default endpoint('POST', (req: VercelRequest) => rescheduleOwnerAppointment(req.headers.authorization, appointmentIdParam(req), readBody(req), liveDeps()), { tag: 'shop/appointments/[id]/reschedule' });
