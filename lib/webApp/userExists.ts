// Supabase auth lookups by user id (service role). Kept apart so the webhook and delete-account share one definition.
const enc = encodeURIComponent;
async function adminUser(userId: string): Promise<{ status: number; user: any } | null> {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null; // unconfigured (tests, local): cannot tell
  const r = await fetch(`${url}/auth/v1/admin/users/${enc(userId)}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  return { status: r.status, user: r.ok ? await r.json().catch(() => null) : null };
}
/** False only when Supabase says the user is gone (404). Any doubt means "exists", so a real customer is never dropped. */
export async function userExists(userId: string): Promise<boolean> {
  try { return (await adminUser(userId))?.status !== 404; } catch { return true; }
}
/** The account's email, or null (no email, user gone, or unknown). */
export async function emailOfUser(userId: string): Promise<string | null> {
  try { const u = (await adminUser(userId))?.user; return typeof u?.email === 'string' && u.email ? u.email : null; } catch { return null; }
}
