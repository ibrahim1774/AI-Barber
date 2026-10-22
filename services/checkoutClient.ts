// Browser helpers for opening a site Checkout (re-review R1).
import { supabase } from '../lib/supabase';

/** Authorization for the signed-in account, else nothing. Never throws. */
export async function authHeaders(): Promise<Record<string, string>> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

const rand = (n: number) => {
  const a = 'abcdefghijkmnpqrstuvwxyz23456789';
  let out = '';
  const bytes = new Uint8Array(n);
  try { crypto.getRandomValues(bytes); } catch { for (let i = 0; i < n; i++) bytes[i] = Math.floor(Math.random() * 256); }
  for (let i = 0; i < n; i++) out += a[bytes[i] % a.length];
  return out;
};

/** The canonical slug (same rules as the server's lib/publishSite.ts slugify). */
export function toSlug(raw: string): string {
  return raw.toLowerCase().replace(/[''`]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').substring(0, 50).replace(/-+$/, '');
}

/**
 * /custom-15 pay-first: the buyer pays before naming the shop, so every purchase gets its own
 * placeholder slug (never the shared sample name); the details step picks the real one.
 */
export function payFirstPlaceholderSlug(sampleSlug: string): string {
  return toSlug(`${sampleSlug || 'barbershop'}-${rand(8)}`);
}

/** The slug the details step publishes to: the real shop name plus a short suffix (unique per purchase). */
export function payFirstSiteSlug(shopName: string): string {
  return toSlug(`${toSlug(shopName).slice(0, 40) || 'barbershop'}-${rand(4)}`);
}

/** A checkout refusal the visitor can act on. */
export function checkoutErrorMessage(status: number, data: any): string {
  if (status === 409 && data?.error === 'site-owned') {
    return 'That name is taken — pick another shop name. If this is your site, sign in first.';
  }
  return data?.error || 'Failed to create checkout session';
}
