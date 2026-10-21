import type { VercelRequest } from '@vercel/node';
import { endpoint, query } from '../../lib/bookings/http.js';
import { liveDeps } from '../../lib/bookings/live.js';
import { getShop } from '../../lib/bookings/publicFlow.js';

// GET ?slug= -> the booking page's shop, services and barbers (or { paused: true }).
export default endpoint('GET', (req: VercelRequest) => getShop({ slug: query(req, 'slug') }, liveDeps()), { rate: 'read', tag: 'book/shop' });
