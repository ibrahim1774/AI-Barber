import type { VercelRequest } from '@vercel/node';
import { endpoint, query } from '../../lib/bookings/http.js';
import { liveDeps } from '../../lib/bookings/live.js';
import { getIcs } from '../../lib/bookings/publicFlow.js';

// GET ?t=<member ics_token> -> that barber's calendar feed (text/calendar).
export default endpoint('GET', (req: VercelRequest) => getIcs({ t: query(req, 't') }, liveDeps()), { rate: 'read', tag: 'book/ics' });
