import type { VercelRequest } from '@vercel/node';
import { endpoint, readBody } from '../../../../lib/bookings/http.js';
import { orderIdParam } from '../../../../lib/store/http.js';
import { liveStoreDeps } from '../../../../lib/store/live.js';
import { markOwnerOrder } from '../../../../lib/store/ownerFlow.js';

// POST (owner JWT) /api/shop/orders/:id/mark { action: 'paid'|'ready'|'shipped'|'done'|'cancel', trackingNumber?, trackingUrl? } -> { order }.
export default endpoint('POST', (req: VercelRequest) => markOwnerOrder(req.headers.authorization, orderIdParam(req), readBody(req), liveStoreDeps()), { tag: 'shop/orders/[id]/mark' });
