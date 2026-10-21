import type { VercelRequest } from '@vercel/node';
import { endpoint, readBody } from '../../lib/bookings/http.js';
import { liveStoreDeps } from '../../lib/store/live.js';
import { createOrder } from '../../lib/store/publicFlow.js';

// POST an order from the shop page (201, 409 sold-out/cart-changed/checkout-expired, 423 paused, 502 payment-unavailable).
export default endpoint('POST', (req: VercelRequest) => createOrder(readBody(req), liveStoreDeps()), { rate: 'write', tag: 'store/orders' });
