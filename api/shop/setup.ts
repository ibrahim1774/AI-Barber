import type { VercelRequest } from '@vercel/node';
import { endpoint, readBody } from '../../lib/bookings/http.js';
import { liveDeps } from '../../lib/bookings/live.js';
import { setupShop } from '../../lib/bookings/ownerFlow.js';

// POST (owner JWT) -> create or return the caller's shop. Inserts with the service role.
export default endpoint('POST', (req: VercelRequest) => setupShop(req.headers.authorization, readBody(req), liveDeps()), { tag: 'shop/setup' });
