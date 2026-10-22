import { supabase } from '@/lib/supabase';

/**
 * Supabase data layer for the ab_* tables (migration 005/006). The app talks to
 * Supabase under RLS; shops are only ever INSERTED by /api/shop/setup (service
 * role). Updates here send only the columns `authenticated` may write: never
 * slug, owner_id, platform_fee_bps, ios_otid or the Stripe columns.
 */

export type ManualHandles = { cashapp?: string; venmo?: string; zelle?: string; paypal?: string };
export type ManualMethod = keyof ManualHandles;

export type Shop = {
  id: string;
  slug: string;
  name: string;
  timezone: string;
  bookingsEnabled: boolean;
  /** The shop is tied to an App Store purchase (ab_shops.ios_otid is set). Until then the public page stays paused. */
  purchaseLinked: boolean;
  payInShop: boolean;
  manualHandles: ManualHandles;
  stripeChargesEnabled: boolean;
  // Beyond the shared contract (read-only for A1).
  stripeConnected: boolean;
  platformFeeBps: number;
  leadDays: number;
  minNoticeMin: number;
  bufferMin: number;
  cancelCutoffMin: number;
  slotStepMin: number | null;
  address: string;
  phone: string;
  accent: string;
  dailySummary: boolean;
};

export type Member = {
  id: string;
  shopId: string;
  role: 'owner' | 'barber';
  name: string;
  photoUrl: string | null;
  bio: string;
  sort: number;
  icsToken: string | null;
};

export type DepositType = 'none' | 'fixed' | 'percent';

export type Service = {
  id: string;
  shopId: string;
  name: string;
  priceCents: number | null;
  durationMin: number;
  description: string;
  photoUrl: string | null;
  bookable: boolean;
  showOnSite: boolean;
  depositType: DepositType;
  depositValue: number | null;
  sort: number;
};

export type AvailabilityRow = {
  weekday: number; // 0 = Monday
  startMin: number;
  endMin: number;
  breakStartMin: number | null;
  breakEndMin: number | null;
};

export type TimeOff = { id: string; memberId: string; startAt: string; endAt: string; reason: string };

const BOOKING_BASE = 'https://www.aibarber.org/book';

/** The public booking page: https://www.aibarber.org/book/{slug}. */
export function bookingUrl(shop: Pick<Shop, 'slug'>): string {
  return `${BOOKING_BASE}/${shop.slug}`;
}

/** True when `url` is an AI Barber booking page link (any shop). */
export function isAiBarberBookingUrl(url?: string | null): boolean {
  return !!url && /^(https?:\/\/)?(www\.)?aibarber\.org\/book(?=[/?#]|$)/i.test(url.trim());
}

/** The calendar feed for one barber (S1 `GET /api/book/ics?t=`). */
export function icsUrl(member: Pick<Member, 'icsToken'>): string | null {
  return member.icsToken ? `https://www.aibarber.org/api/book/ics?t=${member.icsToken}` : null;
}

function fail(error: { message?: string } | null): never {
  throw new Error(error?.message || 'Something went wrong. Please try again.');
}

// ---- mappers (exported for tests) -------------------------------------

export function toShop(r: Record<string, any>): Shop {
  const handles = r.manual_handles && typeof r.manual_handles === 'object' ? r.manual_handles : {};
  return {
    id: r.id,
    slug: r.slug ?? '',
    name: r.name ?? '',
    timezone: r.timezone ?? 'America/New_York',
    bookingsEnabled: !!r.bookings_enabled,
    purchaseLinked: !!r.ios_otid,
    payInShop: r.pay_in_shop !== false,
    manualHandles: handles as ManualHandles,
    stripeChargesEnabled: !!r.stripe_charges_enabled,
    stripeConnected: !!r.stripe_account_id,
    platformFeeBps: typeof r.platform_fee_bps === 'number' ? r.platform_fee_bps : 200,
    leadDays: r.lead_days ?? 30,
    minNoticeMin: r.min_notice_min ?? 120,
    bufferMin: r.buffer_min ?? 0,
    cancelCutoffMin: r.cancel_cutoff_min ?? 120,
    slotStepMin: r.slot_step_min ?? null,
    address: r.address ?? '',
    phone: r.phone ?? '',
    accent: r.accent ?? '',
    dailySummary: !!r.daily_summary,
  };
}

export function toMember(r: Record<string, any>): Member {
  return {
    id: r.id,
    shopId: r.shop_id,
    role: r.role === 'owner' ? 'owner' : 'barber',
    name: r.display_name ?? '',
    photoUrl: r.photo_url ?? null,
    bio: r.bio ?? '',
    sort: r.sort ?? 0,
    icsToken: r.ics_token ?? null,
  };
}

export function toService(r: Record<string, any>): Service {
  return {
    id: r.id,
    shopId: r.shop_id,
    name: r.name ?? '',
    priceCents: r.price_cents ?? null,
    durationMin: r.duration_min ?? 30,
    description: r.description ?? '',
    photoUrl: r.photo_url ?? null,
    bookable: r.bookable !== false,
    showOnSite: r.show_on_site !== false,
    depositType: (r.deposit_type ?? 'none') as DepositType,
    depositValue: r.deposit_value ?? null,
    sort: r.sort ?? 0,
  };
}

const serviceRow = (s: Partial<Service>) => {
  const o: Record<string, unknown> = {};
  if (s.name !== undefined) o.name = s.name;
  if (s.priceCents !== undefined) o.price_cents = s.priceCents;
  if (s.durationMin !== undefined) o.duration_min = s.durationMin;
  if (s.description !== undefined) o.description = s.description || null;
  if (s.photoUrl !== undefined) o.photo_url = s.photoUrl;
  if (s.bookable !== undefined) o.bookable = s.bookable;
  if (s.showOnSite !== undefined) o.show_on_site = s.showOnSite;
  if (s.depositType !== undefined) {
    o.deposit_type = s.depositType;
    o.deposit_value = s.depositType === 'none' ? null : s.depositValue ?? 0;
  }
  if (s.sort !== undefined) o.sort = s.sort;
  return o;
};

// ---- shop --------------------------------------------------------------

async function currentUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user?.id ?? null;
}

/** The signed-in owner's shop, or null (no session, or bookings never set up). */
export async function loadMyShop(): Promise<Shop | null> {
  const uid = await currentUserId();
  if (!uid) return null;
  const { data, error } = await supabase.from('ab_shops').select('*').eq('owner_id', uid).maybeSingle();
  if (error) fail(error);
  return data ? toShop(data as Record<string, any>) : null;
}

/** Settings the app may write (the column grants of 005/006). */
export type ShopSettings = Partial<{
  name: string;
  bookingsEnabled: boolean;
  payInShop: boolean;
  manualHandles: ManualHandles;
  leadDays: number;
  minNoticeMin: number;
  bufferMin: number;
  cancelCutoffMin: number;
  slotStepMin: number | null;
  address: string;
  phone: string;
  accent: string;
  dailySummary: boolean;
}>;

export function shopSettingsRow(s: ShopSettings): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  if (s.name !== undefined) o.name = s.name;
  if (s.bookingsEnabled !== undefined) o.bookings_enabled = s.bookingsEnabled;
  if (s.payInShop !== undefined) o.pay_in_shop = s.payInShop;
  if (s.manualHandles !== undefined) o.manual_handles = s.manualHandles;
  if (s.leadDays !== undefined) o.lead_days = s.leadDays;
  if (s.minNoticeMin !== undefined) o.min_notice_min = s.minNoticeMin;
  if (s.bufferMin !== undefined) o.buffer_min = s.bufferMin;
  if (s.cancelCutoffMin !== undefined) o.cancel_cutoff_min = s.cancelCutoffMin;
  if (s.slotStepMin !== undefined) o.slot_step_min = s.slotStepMin;
  if (s.address !== undefined) o.address = s.address;
  if (s.phone !== undefined) o.phone = s.phone;
  if (s.accent !== undefined) o.accent = s.accent;
  if (s.dailySummary !== undefined) o.daily_summary = s.dailySummary;
  return o;
}

export async function updateShopSettings(shopId: string, settings: ShopSettings): Promise<void> {
  const row = shopSettingsRow(settings);
  if (Object.keys(row).length === 0) return;
  const { error } = await supabase.from('ab_shops').update(row).eq('id', shopId);
  if (error) fail(error);
}

// ---- members -----------------------------------------------------------

export async function listMembers(shopId: string): Promise<Member[]> {
  const { data, error } = await supabase
    .from('ab_members').select('*').eq('shop_id', shopId).eq('active', true).order('sort', { ascending: true });
  if (error) fail(error);
  return ((data ?? []) as Record<string, any>[]).map(toMember);
}

export async function addMember(
  shopId: string,
  m: { name: string; bio?: string; photoUrl?: string | null; sort?: number },
): Promise<Member> {
  const { data, error } = await supabase
    .from('ab_members')
    .insert({ shop_id: shopId, role: 'barber', display_name: m.name, bio: m.bio || null, photo_url: m.photoUrl ?? null, sort: m.sort ?? 10 })
    .select('*')
    .single();
  if (error) fail(error);
  return toMember(data as Record<string, any>);
}

export async function updateMember(
  id: string,
  m: Partial<{ name: string; bio: string; photoUrl: string | null }>,
): Promise<void> {
  const row: Record<string, unknown> = {};
  if (m.name !== undefined) row.display_name = m.name;
  if (m.bio !== undefined) row.bio = m.bio || null;
  if (m.photoUrl !== undefined) row.photo_url = m.photoUrl;
  if (Object.keys(row).length === 0) return;
  const { error } = await supabase.from('ab_members').update(row).eq('id', id);
  if (error) fail(error);
}

/** Number of upcoming, not-cancelled appointments for a barber. */
export async function countUpcoming(memberId: string): Promise<number> {
  const { count, error } = await supabase
    .from('ab_appointments')
    .select('id', { count: 'exact', head: true })
    .eq('member_id', memberId)
    .eq('status', 'booked')
    .gte('start_at', new Date().toISOString());
  if (error) fail(error);
  return count ?? 0;
}

/** Removal is a soft delete (active = false): appointments keep their barber. */
export async function removeMember(id: string): Promise<void> {
  const { error } = await supabase.from('ab_members').update({ active: false }).eq('id', id).eq('role', 'barber');
  if (error) fail(error);
  // No rows means "does every service", so a removed barber's leftovers must go.
  const links = await supabase.from('ab_service_members').delete().eq('member_id', id);
  if (links.error) fail(links.error);
}

// ---- per-barber availability ------------------------------------------

export async function listAvailability(memberId: string): Promise<AvailabilityRow[]> {
  const { data, error } = await supabase.from('ab_availability').select('*').eq('member_id', memberId);
  if (error) fail(error);
  return ((data ?? []) as Record<string, any>[]).map((r) => ({
    weekday: r.weekday,
    startMin: r.start_min,
    endMin: r.end_min,
    breakStartMin: r.break_start_min ?? null,
    breakEndMin: r.break_end_min ?? null,
  }));
}

/** One row per open day: upserts the open days and deletes the closed ones. */
export async function saveAvailability(memberId: string, open: AvailabilityRow[]): Promise<void> {
  const openDays = new Set(open.map((r) => r.weekday));
  const closed = [0, 1, 2, 3, 4, 5, 6].filter((d) => !openDays.has(d));
  if (open.length) {
    const rows = open.map((r) => ({
      member_id: memberId, weekday: r.weekday, start_min: r.startMin, end_min: r.endMin,
      break_start_min: r.breakStartMin, break_end_min: r.breakEndMin,
    }));
    const { error } = await supabase.from('ab_availability').upsert(rows, { onConflict: 'member_id,weekday' });
    if (error) fail(error);
  }
  if (closed.length) {
    const { error } = await supabase.from('ab_availability').delete().eq('member_id', memberId).in('weekday', closed);
    if (error) fail(error);
  }
}

// ---- time off ----------------------------------------------------------

export async function listTimeOff(memberId: string): Promise<TimeOff[]> {
  const { data, error } = await supabase
    .from('ab_time_off').select('*').eq('member_id', memberId).gte('end_at', new Date().toISOString()).order('start_at', { ascending: true });
  if (error) fail(error);
  return ((data ?? []) as Record<string, any>[]).map((r) => ({
    id: r.id, memberId: r.member_id, startAt: r.start_at, endAt: r.end_at, reason: r.reason ?? '',
  }));
}

export async function deleteTimeOff(id: string): Promise<void> {
  const { error } = await supabase.from('ab_time_off').delete().eq('id', id);
  if (error) fail(error);
}
// Creating time off goes through POST /api/shop/time-off (A1), which lists conflicts.

// ---- services ----------------------------------------------------------

export async function listServices(shopId: string): Promise<Service[]> {
  const { data, error } = await supabase
    .from('ab_services').select('*').eq('shop_id', shopId).eq('active', true).order('sort', { ascending: true });
  if (error) fail(error);
  return ((data ?? []) as Record<string, any>[]).map(toService);
}

export async function addService(
  shopId: string,
  s: Pick<Service, 'name' | 'durationMin'> & Partial<Service>,
): Promise<Service> {
  const { data, error } = await supabase
    .from('ab_services').insert({ shop_id: shopId, ...serviceRow(s) }).select('*').single();
  if (error) fail(error);
  return toService(data as Record<string, any>);
}

export async function updateService(id: string, s: Partial<Service>): Promise<void> {
  const row = serviceRow(s);
  if (Object.keys(row).length === 0) return;
  const { error } = await supabase.from('ab_services').update(row).eq('id', id);
  if (error) fail(error);
}

/** Soft delete: past appointments keep their snapshot, and the FK stays valid. */
export async function removeService(id: string): Promise<void> {
  const { error } = await supabase.from('ab_services').update({ active: false }).eq('id', id);
  if (error) fail(error);
  const links = await supabase.from('ab_service_members').delete().eq('service_id', id);
  if (links.error) fail(links.error);
}

export async function reorderServices(ids: string[]): Promise<void> {
  for (let i = 0; i < ids.length; i++) {
    const { error } = await supabase.from('ab_services').update({ sort: i }).eq('id', ids[i]);
    if (error) fail(error);
  }
}

// ---- which services a barber offers -----------------------------------

/** null = every service (no rows). */
export async function getMemberServiceIds(memberId: string): Promise<string[] | null> {
  const { data, error } = await supabase.from('ab_service_members').select('service_id').eq('member_id', memberId);
  if (error) fail(error);
  const ids = ((data ?? []) as { service_id: string }[]).map((r) => r.service_id);
  return ids.length ? ids : null;
}

/** null (or every service) clears the rows: the barber offers everything. */
export async function setMemberServiceIds(memberId: string, ids: string[] | null): Promise<void> {
  const del = await supabase.from('ab_service_members').delete().eq('member_id', memberId);
  if (del.error) fail(del.error);
  if (ids && ids.length) {
    const { error } = await supabase
      .from('ab_service_members').insert(ids.map((service_id) => ({ service_id, member_id: memberId })));
    if (error) fail(error);
  }
}
