import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { clientIp, signupEmailLimiter, signupIpLimiter } from '../../lib/bookings/rateLimit.js';
import { runSignup, type SignupDeps } from '../../lib/ios/signup.js';

// POST { name, email, phone, password } -> 200 { ok, email } (then the app signs in with email +
// password) | 400 bad-request{field} / weak-password | 409 email-exists | 429 | 503.
// Creates the Supabase user already confirmed (admin API, service role). See lib/ios/signup.ts.
export function liveSignupDeps(): SignupDeps {
  return {
    allow: async (ip, email) => {
      const key = createHash('sha256').update(email).digest('hex');
      const [a, b] = await Promise.all([signupIpLimiter.allow(ip, 'write'), signupEmailLimiter.allow(key, 'write')]);
      return a && b;
    },
    createUser: async ({ email, password, metadata }) => {
      const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
      const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
      const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: metadata });
      if (!error) return { exists: false };
      const code = (error as any).code;
      const status = (error as any).status;
      if (code === 'email_exists' || code === 'user_already_exists' || /already (been )?registered|already exists/i.test(error.message || '')) {
        return { exists: true };
      }
      if (code === 'weak_password') throw new Error('supabase rejected the password policy');
      throw new Error(`createUser failed (${status ?? '?'}): ${error.message}`);
    },
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'OPTIONS,POST');
  res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' });
  try {
    let body: any;
    try {
      body = req.body;
    } catch {
      return res.status(400).json({ error: 'bad-request' });
    }
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'bad-request' }); }
    }
    const r = await runSignup(body, clientIp(req.headers as any), liveSignupDeps());
    if (r.status === 429) res.setHeader('Retry-After', '60');
    return res.status(r.status).json(r.body);
  } catch (e: any) {
    console.error('[ios/signup] handler error:', e?.message || e);
    return res.status(503).json({ error: 'temporarily-unavailable' });
  }
}
