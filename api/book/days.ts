import type { VercelRequest } from '@vercel/node';
import { endpoint, query } from '../../lib/bookings/http.js';
import { liveDeps } from '../../lib/bookings/live.js';
import { getDays } from '../../lib/bookings/publicFlow.js';

// GET ?slug=&serviceId=&memberId=any|<uuid>&month=YYYY-MM -> days with at least one free slot.
export default endpoint('GET', (req: VercelRequest) => getDays({ slug: query(req, 'slug'), serviceId: query(req, 'serviceId'), memberId: query(req, 'memberId'), month: query(req, 'month') }, liveDeps()), { rate: 'read', tag: 'book/days' });
