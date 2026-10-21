import type { VercelRequest } from '@vercel/node';
import { endpoint, query } from '../../lib/bookings/http.js';
import { liveStoreDeps } from '../../lib/store/live.js';
import { getOrder } from '../../lib/store/publicFlow.js';

// GET ?token= -> the order behind a status link (never gated).
export default endpoint('GET', (req: VercelRequest) => getOrder({ token: query(req, 'token') }, liveStoreDeps()), { rate: 'read', tag: 'store/order' });
