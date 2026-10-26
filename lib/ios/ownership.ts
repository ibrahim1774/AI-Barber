import { createClient } from '@supabase/supabase-js';
import type { PurchaseRow } from './purchases.js';

// Apple ID vs account ownership (2026-10-26, DECIDED): a subscription is linked ONCE to the
// account (ios_purchases.user_id) that made the first verified purchase or Restore, and is NEVER
// movable afterwards: no transfer, no re-link, no release. A second email on the same Apple ID is
// simply unpaid. These helpers are shared by /api/ios/site, /api/ios/publish and /api/shop/plan.

/** First letter + domain: "alice@gmail.com" -> "a***@gmail.com". Null when it is not an email. */
export function maskEmail(email: string | null | undefined): string | null {
  if (typeof email !== 'string') return null;
  const e = email.trim();
  const at = e.lastIndexOf('@');
  if (at < 1 || at === e.length - 1) return null;
  return `${e[0].toLowerCase()}***@${e.slice(at + 1).toLowerCase()}`;
}

export interface OtherAccountBody {
  error: 'purchase-other-account';
  /** Masked email of the account that owns the purchase (a***@gmail.com), or null when unknown. */
  hint: string | null;
}

/** The 409 body: never the other account's id, never its full email, never any site data. */
export async function otherAccountBody(
  emailOf: ((userId: string) => Promise<string | null>) | undefined,
  ownerId: string | null,
): Promise<OtherAccountBody> {
  let hint: string | null = null;
  if (ownerId && emailOf) {
    try {
      hint = maskEmail(await emailOf(ownerId));
    } catch {
      hint = null; // the hint is a courtesy: a failing lookup never changes the 409
    }
  }
  return { error: 'purchase-other-account', hint };
}

function adminClient() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** The email behind an account id (service role), for the masked hint only. */
export async function liveEmailOf(userId: string): Promise<string | null> {
  const { data } = await adminClient().auth.admin.getUserById(userId);
  return data?.user?.email ?? null;
}

/** Who the shop/site bound to a purchase belongs to: an account id, 'ambiguous' (several), or null (nobody yet). */
export type BindingOwner = string | 'ambiguous' | null;

/**
 * Legacy / not-yet-linked purchase (no user_id): the account that owns the ab_shops row whose
 * ios_otid is the purchase, else the one owning the sites row at the purchase's slug URL. Null when
 * nothing is attached yet (a no-account publish nobody has synced), 'ambiguous' for several owners.
 */
export async function liveBindingOwner(row: PurchaseRow): Promise<BindingOwner> {
  const db = adminClient();
  const { data: shop, error } = await db.from('ab_shops').select('owner_id').eq('ios_otid', row.original_transaction_id).maybeSingle();
  if (error) throw new Error(`ab_shops ownership lookup failed: ${error.message}`);
  if (shop) return (shop as any).owner_id ?? null;
  if (!row.site_slug) return null;
  const u = `https://${row.site_slug}.vercel.app`;
  const { data: sites, error: sErr } = await db.from('sites').select('user_id').in('deployed_url', [u, `${u}/`]);
  if (sErr) throw new Error(`sites ownership lookup failed: ${sErr.message}`);
  const owners = [...new Set((sites || []).map((r: any) => r.user_id).filter(Boolean))];
  return owners.length === 0 ? null : owners.length === 1 ? (owners[0] as string) : 'ambiguous';
}
