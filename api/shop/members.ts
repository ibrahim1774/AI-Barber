import type { VercelRequest } from '@vercel/node';
import { endpoint, readBody } from '../../lib/bookings/http.js';
import { liveDeps } from '../../lib/bookings/live.js';
import { addTeamMember } from '../../lib/bookings/ownerFlow.js';

// POST (owner JWT) { name, title?, photo?, bio?, bookingUrl? } -> adds a barber, limit by plan
// (Store 5, Bookings 2). 200 { member, limit } | 403 members-need-bookings | 409 member-limit { limit }.
export default endpoint('POST', (req: VercelRequest) => addTeamMember(req.headers.authorization, readBody(req), liveDeps()), { tag: 'shop/members' });
