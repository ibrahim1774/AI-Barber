import type { VercelRequest, VercelResponse } from '@vercel/node';
import { endpoint, query, readBody, setCors } from '../../lib/bookings/http.js';
import { liveDeps } from '../../lib/bookings/live.js';
import { getManage, postManage } from '../../lib/bookings/publicFlow.js';

// GET ?token= -> the booking behind a manage link.
// POST { token, action: 'cancel' } | { token, action: 'reschedule', start, memberId? }.
const get = endpoint('GET', (req) => getManage({ token: query(req, 'token') }, liveDeps()), { rate: 'read', tag: 'book/manage' });
const post = endpoint('POST', (req) => postManage(readBody(req), liveDeps()), { rate: 'write', tag: 'book/manage' });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'POST') return post(req, res);
  if (req.method === 'OPTIONS') {
    setCors(res, 'GET,POST');
    return res.status(200).end();
  }
  return get(req, res);
}
