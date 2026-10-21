import type { VercelRequest } from '@vercel/node';
import { endpoint, readBody } from '../../lib/bookings/http.js';
import { liveDeps } from '../../lib/bookings/live.js';
import { registerPushToken } from '../../lib/bookings/ownerFlow.js';

// POST (JWT) { expoToken, platform: 'ios' } -> upsert the device's push token for this user.
export default endpoint('POST', (req: VercelRequest) => registerPushToken(req.headers.authorization, readBody(req), liveDeps()), { tag: 'shop/push-token' });
