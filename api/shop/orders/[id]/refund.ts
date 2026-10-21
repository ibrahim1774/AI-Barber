import type { VercelRequest } from '@vercel/node';
import { endpoint, readBody } from '../../../../lib/bookings/http.js';
import { orderIdParam } from '../../../../lib/store/http.js';
import { liveStoreDeps } from '../../../../lib/store/live.js';
import { refundOwnerOrder } from '../../../../lib/store/ownerFlow.js';

// POST (owner JWT) /api/shop/orders/:id/refund { amountCents? } -> { order, refundedCents, pending }.
export default endpoint('POST', (req: VercelRequest) => refundOwnerOrder(req.headers.authorization, orderIdParam(req), readBody(req), liveStoreDeps()), { tag: 'shop/orders/[id]/refund' });
