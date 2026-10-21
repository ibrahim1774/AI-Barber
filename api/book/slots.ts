import type { VercelRequest } from '@vercel/node';
import { endpoint, query } from '../../lib/bookings/http.js';
import { liveDeps } from '../../lib/bookings/live.js';
import { getSlots } from '../../lib/bookings/publicFlow.js';

// GET ?slug=&serviceId=&memberId=any|<uuid>&date=YYYY-MM-DD -> free start times.
export default endpoint('GET', (req: VercelRequest) => getSlots({ slug: query(req, 'slug'), serviceId: query(req, 'serviceId'), memberId: query(req, 'memberId'), date: query(req, 'date') }, liveDeps()), { rate: 'read', tag: 'book/slots' });
