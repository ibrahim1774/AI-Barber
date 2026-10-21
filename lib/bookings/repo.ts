// Data access for the booking API. Everything here runs with the Supabase SERVICE ROLE
// (bypasses RLS), so callers must already have decided which shop the caller may touch:
// public endpoints resolve the shop from its slug / a manage token, owner endpoints from
// the verified JWT's user id. Never pass an id from a request body straight through.
//
// The interface is domain-level (e.g. insertAppointment reports 'overlap' instead of a
// Postgres error) so the flows are testable with an in-memory fake.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export type ManualHandles = { cashapp?: string; venmo?: string; zelle?: string; paypal?: string };
export type ManualMethod = keyof ManualHandles;
export const MANUAL_METHODS: readonly ManualMethod[] = ['cashapp', 'venmo', 'zelle', 'paypal'];

export interface ShopRow {
  id: string;
  owner_id: string;
  site_id: string | null;
  slug: string | null;
  name: string;
  timezone: string;
  currency: string;
  lead_days: number;
  min_notice_min: number;
  buffer_min: number;
  cancel_cutoff_min: number;
  slot_step_min: number | null;
  pay_in_shop: boolean;
  manual_handles: ManualHandles | null;
  stripe_account_id: string | null;
  stripe_charges_enabled: boolean;
  platform_fee_bps: number;
  bookings_enabled: boolean;
  ios_otid: string | null;
  address: string | null;
  phone: string | null;
  accent: string | null;
  daily_summary: boolean;
}

export interface MemberRow {
  id: string;
  shop_id: string;
  user_id: string | null;
  role: 'owner' | 'barber';
  display_name: string;
  photo_url: string | null;
  bio: string | null;
  sort: number;
  active: boolean;
  ics_token: string | null;
}

export type DepositType = 'none' | 'fixed' | 'percent';

export interface ServiceRow {
  id: string;
  shop_id: string;
  name: string;
  price_cents: number | null;
  duration_min: number;
  description: string | null;
  photo_url: string | null;
  bookable: boolean;
  show_on_site: boolean;
  deposit_type: DepositType;
  deposit_value: number | null;
  sort: number;
  active: boolean;
}

export interface ServiceMemberRow {
  service_id: string;
  member_id: string;
  price_override_cents: number | null;
}

export interface AvailabilityDbRow {
  member_id: string;
  weekday: number;
  start_min: number;
  end_min: number;
  break_start_min: number | null;
  break_end_min: number | null;
}

export interface TimeOffRow {
  id: string;
  member_id: string;
  start_at: string;
  end_at: string;
  reason: string | null;
}

export interface BusyRow {
  id: string;
  member_id: string;
  start_at: string;
  end_at: string;
}

export type AppointmentStatus = 'booked' | 'done' | 'no_show' | 'cancelled';
export type PaymentStatus = 'none' | 'awaiting' | 'deposit' | 'paid' | 'refunded' | 'partially_refunded';
export type PaymentMethod = 'shop' | ManualMethod | 'card';

export interface AppointmentRow {
  id: string;
  shop_id: string;
  member_id: string;
  service_id: string | null;
  start_at: string;
  end_at: string;
  service_name: string;
  price_cents: number | null;
  duration_min: number;
  customer_name: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  note: string | null;
  status: AppointmentStatus;
  cancelled_by: 'customer' | 'shop' | null;
  cancelled_at: string | null;
  reminder_sent_at: string | null;
  payment_status: PaymentStatus;
  payment_method: PaymentMethod | null;
  amount_paid_cents: number;
  amount_refunded_cents: number;
  stripe_payment_intent_id: string | null;
  stripe_checkout_session_id: string | null;
  manage_token: string;
  source: 'online' | 'walk_in';
  customer_says_paid_at: string | null;
  created_at?: string;
}

export type NewAppointment = Pick<
  AppointmentRow,
  | 'shop_id' | 'member_id' | 'service_id' | 'start_at' | 'end_at' | 'service_name' | 'price_cents' | 'duration_min'
  | 'customer_name' | 'customer_phone' | 'customer_email' | 'note' | 'payment_status' | 'payment_method' | 'source'
>;

export type AppointmentPatch = Partial<Pick<
  AppointmentRow,
  | 'member_id' | 'start_at' | 'end_at' | 'status' | 'cancelled_by' | 'cancelled_at' | 'reminder_sent_at'
  | 'payment_status' | 'payment_method' | 'amount_refunded_cents' | 'stripe_checkout_session_id' | 'customer_says_paid_at'
>>;

export type WriteResult<T> = { ok: true; row: T } | { ok: false; reason: 'overlap' | 'stale' };

export interface PurchaseGateRow {
  user_id: string | null;
  revoked_at: string | null;
  taken_down_at: string | null;
}

export type NewShop = Pick<ShopRow, 'owner_id' | 'site_id' | 'slug' | 'name' | 'timezone' | 'address' | 'phone' | 'accent' | 'bookings_enabled'>;
export type InsertShopResult = { ok: true; row: ShopRow } | { ok: false; reason: 'owner-exists' | 'slug-taken' };

export interface NewService {
  shop_id: string;
  name: string;
  price_cents: number | null;
  duration_min: number;
  description: string | null;
  photo_url: string | null;
  sort: number;
}

export interface BookingRepo {
  shopBySlug(slug: string): Promise<ShopRow | null>;
  shopByOwner(userId: string): Promise<ShopRow | null>;
  shopById(id: string): Promise<ShopRow | null>;
  /** ios_purchases row behind the bookings gate (null when there is none). */
  purchase(otid: string): Promise<PurchaseGateRow | null>;

  services(shopId: string): Promise<ServiceRow[]>;
  members(shopId: string): Promise<MemberRow[]>;
  serviceMembers(serviceIds: string[]): Promise<ServiceMemberRow[]>;
  availability(memberIds: string[]): Promise<AvailabilityDbRow[]>;
  /** Time off overlapping [fromIso, toIso). */
  timeOff(memberIds: string[], fromIso: string, toIso: string): Promise<TimeOffRow[]>;
  /** Non-cancelled appointments overlapping [fromIso, toIso). */
  busy(memberIds: string[], fromIso: string, toIso: string): Promise<BusyRow[]>;
  /** Non-cancelled appointments of the shop starting exactly at startIso (duplicate check). */
  appointmentsStartingAt(shopId: string, startIso: string): Promise<AppointmentRow[]>;
  /** status = 'booked' appointments of one member overlapping [fromIso, toIso). */
  bookedOverlapping(memberId: string, fromIso: string, toIso: string): Promise<AppointmentRow[]>;
  /** Non-cancelled appointments of one member starting in [fromIso, toIso) (calendar feed). */
  memberAppointments(memberId: string, fromIso: string, toIso: string): Promise<AppointmentRow[]>;

  /** 'overlap' = the exclusion constraint (23P01) refused it. */
  insertAppointment(row: NewAppointment): Promise<WriteResult<AppointmentRow>>;
  /** Hard delete (only used to drop a card hold whose checkout could not be created). */
  deleteAppointment(id: string): Promise<void>;
  /**
   * Update, optionally only while status = expectStatus ('stale' when it no longer is, so
   * a double-tapped cancel can never refund twice). 'overlap' = 23P01.
   */
  updateAppointment(id: string, patch: AppointmentPatch, expectStatus?: AppointmentStatus): Promise<WriteResult<AppointmentRow>>;
  appointmentByToken(token: string): Promise<AppointmentRow | null>;
  appointmentById(id: string): Promise<AppointmentRow | null>;

  memberByIcsToken(token: string): Promise<MemberRow | null>;
  findTimeOff(memberId: string, startIso: string, endIso: string): Promise<TimeOffRow | null>;
  insertTimeOff(row: { member_id: string; start_at: string; end_at: string; reason: string | null }): Promise<TimeOffRow>;
  upsertPushToken(userId: string, expoToken: string, platform: 'ios' | 'android'): Promise<void>;
  logEvent(shopId: string | null, kind: string, payload: Record<string, unknown>): Promise<void>;

  // setup
  slugTaken(slug: string): Promise<boolean>;
  insertShop(row: NewShop): Promise<InsertShopResult>;
  setShopOtid(shopId: string, otid: string): Promise<'ok' | 'taken'>;
  insertMember(row: { shop_id: string; user_id: string; role: 'owner'; display_name: string; sort: number }): Promise<MemberRow>;
  insertServices(rows: NewService[]): Promise<void>;
  insertAvailability(rows: Omit<AvailabilityDbRow, 'break_start_min' | 'break_end_min'>[]): Promise<void>;
  /** The sites row with this id: its deployed URL when it is the caller's, 'foreign' when another user's, null when absent. */
  siteDeployedUrl(siteId: string, userId: string): Promise<{ deployedUrl: string | null } | 'foreign' | null>;
}

const SHOP_COLS =
  'id, owner_id, site_id, slug, name, timezone, currency, lead_days, min_notice_min, buffer_min, cancel_cutoff_min, ' +
  'slot_step_min, pay_in_shop, manual_handles, stripe_account_id, stripe_charges_enabled, platform_fee_bps, ' +
  'bookings_enabled, ios_otid, address, phone, accent, daily_summary';
const MEMBER_COLS = 'id, shop_id, user_id, role, display_name, photo_url, bio, sort, active, ics_token';
const SERVICE_COLS =
  'id, shop_id, name, price_cents, duration_min, description, photo_url, bookable, show_on_site, deposit_type, deposit_value, sort, active';
const APPT_COLS = '*';

type PgError = { code?: string; message?: string; details?: string } | null;

function fail(op: string, error: PgError): never {
  throw new Error(`bookings repo ${op} failed: ${error?.message ?? 'unknown'}`);
}

const isOverlap = (e: PgError) => e?.code === '23P01';
const isUnique = (e: PgError) => e?.code === '23505';
const mentions = (e: PgError, name: string) => `${e?.message ?? ''} ${e?.details ?? ''}`.includes(name);

export function serviceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('missing Supabase configuration');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function supabaseBookingRepo(client?: SupabaseClient): BookingRepo {
  let sb = client;
  const db = () => (sb ??= serviceClient());

  const one = async <T>(op: string, q: PromiseLike<{ data: unknown; error: PgError }>): Promise<T | null> => {
    const { data, error } = await q;
    if (error) fail(op, error);
    return (data as T) ?? null;
  };
  const many = async <T>(op: string, q: PromiseLike<{ data: unknown; error: PgError }>): Promise<T[]> => {
    const { data, error } = await q;
    if (error) fail(op, error);
    return (data as T[]) ?? [];
  };

  return {
    shopBySlug: (slug) => one('shopBySlug', db().from('ab_shops').select(SHOP_COLS).eq('slug', slug).maybeSingle()),
    shopByOwner: (userId) => one('shopByOwner', db().from('ab_shops').select(SHOP_COLS).eq('owner_id', userId).maybeSingle()),
    shopById: (id) => one('shopById', db().from('ab_shops').select(SHOP_COLS).eq('id', id).maybeSingle()),
    purchase: (otid) =>
      one('purchase', db().from('ios_purchases').select('user_id, revoked_at, taken_down_at')
        .eq('original_transaction_id', otid).maybeSingle()),

    services: (shopId) =>
      many('services', db().from('ab_services').select(SERVICE_COLS).eq('shop_id', shopId).order('sort').order('created_at')),
    members: (shopId) =>
      many('members', db().from('ab_members').select(MEMBER_COLS).eq('shop_id', shopId).order('sort').order('created_at')),
    async serviceMembers(serviceIds) {
      if (serviceIds.length === 0) return [];
      return many('serviceMembers', db().from('ab_service_members')
        .select('service_id, member_id, price_override_cents').in('service_id', serviceIds));
    },
    async availability(memberIds) {
      if (memberIds.length === 0) return [];
      return many('availability', db().from('ab_availability')
        .select('member_id, weekday, start_min, end_min, break_start_min, break_end_min').in('member_id', memberIds));
    },
    async timeOff(memberIds, fromIso, toIso) {
      if (memberIds.length === 0) return [];
      return many('timeOff', db().from('ab_time_off').select('id, member_id, start_at, end_at, reason')
        .in('member_id', memberIds).lt('start_at', toIso).gt('end_at', fromIso));
    },
    async busy(memberIds, fromIso, toIso) {
      if (memberIds.length === 0) return [];
      return many('busy', db().from('ab_appointments').select('id, member_id, start_at, end_at')
        .in('member_id', memberIds).neq('status', 'cancelled').lt('start_at', toIso).gt('end_at', fromIso));
    },
    appointmentsStartingAt: (shopId, startIso) =>
      many('appointmentsStartingAt', db().from('ab_appointments').select(APPT_COLS)
        .eq('shop_id', shopId).eq('start_at', startIso).neq('status', 'cancelled')),
    bookedOverlapping: (memberId, fromIso, toIso) =>
      many('bookedOverlapping', db().from('ab_appointments').select(APPT_COLS)
        .eq('member_id', memberId).eq('status', 'booked').lt('start_at', toIso).gt('end_at', fromIso).order('start_at')),
    memberAppointments: (memberId, fromIso, toIso) =>
      many('memberAppointments', db().from('ab_appointments').select(APPT_COLS)
        .eq('member_id', memberId).neq('status', 'cancelled').gte('start_at', fromIso).lt('start_at', toIso)
        .order('start_at').limit(2000)),

    async insertAppointment(row) {
      const { data, error } = await db().from('ab_appointments').insert(row).select(APPT_COLS).single();
      if (isOverlap(error)) return { ok: false, reason: 'overlap' };
      if (error) fail('insertAppointment', error);
      return { ok: true, row: data as AppointmentRow };
    },
    async deleteAppointment(id) {
      const { error } = await db().from('ab_appointments').delete().eq('id', id);
      if (error) fail('deleteAppointment', error);
    },
    async updateAppointment(id, patch, expectStatus) {
      let q = db().from('ab_appointments').update(patch).eq('id', id);
      if (expectStatus) q = q.eq('status', expectStatus);
      const { data, error } = await q.select(APPT_COLS);
      if (isOverlap(error)) return { ok: false, reason: 'overlap' };
      if (error) fail('updateAppointment', error);
      const rows = (data as AppointmentRow[]) ?? [];
      return rows.length ? { ok: true, row: rows[0] } : { ok: false, reason: 'stale' };
    },
    appointmentByToken: (token) =>
      one('appointmentByToken', db().from('ab_appointments').select(APPT_COLS).eq('manage_token', token).maybeSingle()),
    appointmentById: (id) =>
      one('appointmentById', db().from('ab_appointments').select(APPT_COLS).eq('id', id).maybeSingle()),

    memberByIcsToken: (token) =>
      one('memberByIcsToken', db().from('ab_members').select(MEMBER_COLS).eq('ics_token', token).maybeSingle()),
    async findTimeOff(memberId, startIso, endIso) {
      const rows = await many<TimeOffRow>('findTimeOff', db().from('ab_time_off').select('id, member_id, start_at, end_at, reason')
        .eq('member_id', memberId).eq('start_at', startIso).eq('end_at', endIso).limit(1));
      return rows[0] ?? null;
    },
    async insertTimeOff(row) {
      const r = await one<TimeOffRow>('insertTimeOff', db().from('ab_time_off').insert(row)
        .select('id, member_id, start_at, end_at, reason').single());
      return r!;
    },
    async upsertPushToken(userId, expoToken, platform) {
      // Service role on purpose: expo_token is globally unique while RLS is per user, so a
      // phone that switches accounts must be able to move its token to the new user.
      const { error } = await db().from('ab_push_tokens')
        .upsert({ user_id: userId, expo_token: expoToken, platform }, { onConflict: 'expo_token' });
      if (error) fail('upsertPushToken', error);
    },
    async logEvent(shopId, kind, payload) {
      const { error } = await db().from('ab_events').insert({ shop_id: shopId, kind, payload });
      if (error) fail('logEvent', error);
    },

    async slugTaken(slug) {
      const rows = await many('slugTaken', db().from('ab_shops').select('id').eq('slug', slug).limit(1));
      return rows.length > 0;
    },
    async insertShop(row) {
      const { data, error } = await db().from('ab_shops').insert(row).select(SHOP_COLS).single();
      if (isUnique(error)) {
        if (mentions(error, 'ab_shops_one_per_owner')) return { ok: false, reason: 'owner-exists' };
        if (mentions(error, 'slug')) return { ok: false, reason: 'slug-taken' };
      }
      if (error) fail('insertShop', error);
      return { ok: true, row: data as unknown as ShopRow };
    },
    async setShopOtid(shopId, otid) {
      const { error } = await db().from('ab_shops').update({ ios_otid: otid }).eq('id', shopId);
      if (isUnique(error)) return 'taken';
      if (error) fail('setShopOtid', error);
      return 'ok';
    },
    async insertMember(row) {
      const r = await one<MemberRow>('insertMember', db().from('ab_members').insert(row).select(MEMBER_COLS).single());
      return r!;
    },
    async insertServices(rows) {
      if (rows.length === 0) return;
      const { error } = await db().from('ab_services').insert(rows);
      if (error) fail('insertServices', error);
    },
    async insertAvailability(rows) {
      if (rows.length === 0) return;
      const { error } = await db().from('ab_availability')
        .upsert(rows, { onConflict: 'member_id,weekday', ignoreDuplicates: true });
      if (error) fail('insertAvailability', error);
    },
    async siteDeployedUrl(siteId, userId) {
      const r = await one<{ user_id: string; deployed_url: string | null }>('siteDeployedUrl',
        db().from('sites').select('user_id, deployed_url').eq('id', siteId).maybeSingle());
      if (!r) return null;
      return r.user_id === userId ? { deployedUrl: r.deployed_url ?? null } : 'foreign';
    },
  };
}
