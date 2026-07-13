import { createClient } from '@supabase/supabase-js';

/*
 * Mirror a user's signup phone into auth.users.phone.
 *
 * Signup collects the phone into user_metadata ({ full_name, phone }) —
 * the only place a client-side signUp can write. The Supabase Auth
 * dashboard's Phone column reads auth.users.phone, which only the admin
 * API can set for email/password users. AuthContext calls this endpoint
 * (fire-and-forget) right after a successful signUp.
 *
 * Safe to expose: it copies the user's OWN metadata phone to their own
 * phone column — no caller-controlled data is written, and re-calls are
 * no-ops once the column is set.
 *
 * Env (AI-Barber Vercel project):
 *   SUPABASE_SERVICE_ROLE_KEY
 *   SUPABASE_URL (falls back to VITE_SUPABASE_URL)
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const userId = typeof req.body?.userId === 'string' ? req.body.userId.toLowerCase() : '';
  if (!UUID_RE.test(userId)) {
    return res.status(400).json({ error: 'userId must be a UUID' });
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({ error: 'Server missing Supabase configuration' });
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data?.user) {
    return res.status(404).json({ error: 'User not found' });
  }

  const user = data.user;
  const metaPhone = user.user_metadata?.phone;
  if (!metaPhone || user.phone) {
    return res.status(200).json({ synced: false, reason: user.phone ? 'already set' : 'no metadata phone' });
  }

  const raw = String(metaPhone).replace(/[^0-9+]/g, '');
  if (raw.replace(/\D/g, '').length < 10) {
    return res.status(200).json({ synced: false, reason: 'phone too short' });
  }
  const phone = raw.startsWith('+') ? raw : `+1${raw}`;

  const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
    phone,
    phone_confirm: true,
  });
  if (updErr) {
    // e.g. another account already holds this phone (unique column) —
    // the metadata copy is still intact, so don't fail the signup path.
    return res.status(200).json({ synced: false, reason: updErr.message });
  }

  return res.status(200).json({ synced: true });
}
