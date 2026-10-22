import type { VercelRequest } from '@vercel/node';
import { endpoint, query } from '../../lib/bookings/http.js';
import { liveStoreDeps } from '../../lib/store/live.js';
import { getStoreShop } from '../../lib/store/publicFlow.js';

// GET ?slug= -> the shop page's store settings and products (or { paused: true }).
export default endpoint('GET', (req: VercelRequest) => getStoreShop({ slug: query(req, 'slug') }, liveStoreDeps()), { rate: 'read', tag: 'store/shop' });
