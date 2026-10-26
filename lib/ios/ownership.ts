import { createClient } from '@supabase/supabase-js';
import type { PurchaseRow } from './purchases.js';

// Apple ID vs account ownership (2026-10-26): a subscription is linked to the account
// (ios_purchases.user_id) that made the first verified purchase or Restore. It follows the Apple ID:
// another signed-in account may take it, but ONLY through POST /api/ios/transfer with an explicit
// confirmation (lib/ios/transfer.ts). Everywhere else a purchase linked to another account is a
// 409 purchase-other-account that carries ownerHint + hasLiveSite so the app can show that
// confirmation. These helpers are shared by /api/ios/site, /api/ios/publish, /api/ios/transfer
// and /api/shop/plan.

/** First letter + domain: "alice@gmail.com" -> "a***@gmail.com". Null when it is not an email. */
export function maskEmail(email: string | null | undefined): string | null {
  if (typeof email !== 'string') return null;
  const e = email.trim();
  const at = e.lastIndexOf('@');
  if (at < 1 || at === e.length - 1) return null;
  return `${e[0].toLowerCase()}***@${e.slice(at + 1).toLowerCase()}`;
}

/** Is a site currently live on this purchase (bound, published, not taken down, not removed)? */
export function hasLiveSite(row: Pick<PurchaseRow, 'site_slug' | 'published_at' | 'taken_down_at' | 'removed_at'> | null | undefined): boolean {
  return !!row && !!row.site_slug && row.published_at != null && row.taken_down_at == null && row.removed_at == null;
}

/** The public URL of a purchase's site (same host rule as liveBindingOwner). */
export const siteUrlOf = (slug: string): string => `https://${slug}.vercel.app`;

export interface OtherAccountBody {
  error: 'purchase-other-account';
  /** Masked email of the account that owns the purchase (a***@gmail.com), or null when unknown. Kept for older builds; same value as ownerHint. */
  hint: string | null;
  /** Same value as `hint`: the name the transfer flow uses. */
  ownerHint: string | null;
  /** The other account has a live site on this purchase (moving the purchase takes it offline). */
  hasLiveSite: boolean;
}

/** The 409 body: never the other account's id, never its full email, never any site data. */
export async function otherAccountBody(
  emailOf: ((userId: string) => Promise<string | null>) | undefined,
  ownerId: string | null,
  row?: Parameters<typeof hasLiveSite>[0],
): Promise<OtherAccountBody> {
  let hint: string | null = null;
  if (ownerId && emailOf) {
    try {
      hint = maskEmail(await emailOf(ownerId));
    } catch {
      hint = null; // the hint is a courtesy: a failing lookup never changes the 409
    }
  }
  return { error: 'purchase-other-account', hint, ownerHint: hint, hasLiveSite: hasLiveSite(row) };
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
export async function liveBindingOwner(row: Pick<PurchaseRow, 'original_transaction_id' | 'site_slug'>): Promise<BindingOwner> {
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
