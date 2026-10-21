import type { VercelRequest } from '@vercel/node';
import { endpoint, readBody } from '../../../../lib/bookings/http.js';
import { orderIdParam } from '../../../../lib/store/http.js';
import { liveStoreDeps } from '../../../../lib/store/live.js';
import { markOwnerOrder } from '../../../../lib/store/ownerFlow.js';

// POST (owner JWT) /api/shop/orders/:id/mark { action: 'paid'|'ready'|'shipped'|'done'|'cancel', trackingNumber?, trackingUrl? } -> { order }.
// Stripe calls and email run here; allow more than the plan's default limit (as api/store/orders.ts does).
export const config = { maxDuration: 30 };

export default endpoint('POST', (req: VercelRequest) => markOwnerOrder(req.headers.authorization, orderIdParam(req), readBody(req), liveStoreDeps()), { tag: 'shop/orders/[id]/mark' });
