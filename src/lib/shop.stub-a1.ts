/**
 * A1's local stand-in for A2's src/lib/shop.ts (signatures from the contract).
 * Deleted at merge: the controller changes the one import line in
 * src/lib/bookings/shop.ts to '@/lib/shop' and removes this file.
 * It reads ab_shops / ab_members / ab_services under RLS, like the real one.
 */
import { supabase } from '@/lib/supabase';

export type Shop = {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  bookingsEnabled: boolean;
  payInShop: boolean;
  manualHandles: Record<string, string>;
  stripeChargesEnabled: boolean;
};
export type Member = { id: string; name: string; role: 'owner' | 'barber'; photoUrl: string | null; active: boolean };
export type Service = { id: string; name: string; priceCents: number | null; durationMin: number; active: boolean };

export async function loadMyShop(): Promise<Shop | null> {
  const { data, error } = await supabase
    .from('ab_shops')
    .select('id, slug, name, timezone, bookings_enabled, pay_in_shop, manual_handles, stripe_charges_enabled')
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const r = data as any;
  return {
    id: r.id, slug: r.slug, name: r.name, timezone: r.timezone, bookingsEnabled: !!r.bookings_enabled,
    payInShop: !!r.pay_in_shop, manualHandles: r.manual_handles ?? {}, stripeChargesEnabled: !!r.stripe_charges_enabled,
  };
}

export async function listMembers(shopId: string): Promise<Member[]> {
  const { data, error } = await (supabase.from('ab_members') as any).select('*').eq('shop_id', shopId).order('sort');
  if (error) throw error;
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id, name: r.display_name, role: r.role, photoUrl: r.photo_url ?? null, active: !!r.active,
  }));
}

export async function listServices(shopId: string): Promise<Service[]> {
  const { data, error } = await (supabase.from('ab_services') as any).select('*').eq('shop_id', shopId).order('sort');
  if (error) throw error;
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id, name: r.name, priceCents: r.price_cents ?? null, durationMin: r.duration_min, active: !!r.active,
  }));
}

export const bookingUrl = (shop: Pick<Shop, 'slug'>): string => `https://www.aibarber.org/book/${shop.slug}`;
