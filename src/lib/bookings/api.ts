import { ApiError } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import type { Appointment, TimeOff } from '@/lib/bookings/calendar';

/**
 * Typed client for the owner side of bookings: the /api/shop/* endpoints
 * (side effects: refunds, emails, pushes, slot rules, mark paid / done / no-show)
 * and direct Supabase reads of ab_appointments under RLS.
 */

const base = () => process.env.EXPO_PUBLIC_API_BASE ?? 'https://www.aibarber.org';
const TIMEOUT_MS = 30_000;
const OFFLINE = "Couldn't reach AI Barber. Check your connection and try again.";

export interface SlotAlternative { start: string; memberId: string }

/** An API failure, with the server's JSON body (e.g. `alternatives` on a 409). */
export class BookingApiError extends ApiError {
  constructor(status: number, code: string, message: string, public data: any = null) {
    super(status, code, message);
    this.name = 'BookingApiError';
  }
}

const FRIENDLY: Record<string, string> = {
  'slot-taken': 'That time is already taken.',
  'bookings-paused': 'Bookings are paused because the subscription has ended.',
  unauthorized: 'Please sign in again.',
  'card-payment': 'Card payments are recorded by Stripe automatically.',
  'not-markable': 'This booking changed. Pull down to refresh.',
};

/** Alternatives from a 409 slot-taken error, else []. */
export function alternativesOf(e: unknown): SlotAlternative[] {
  const alts = (e as BookingApiError)?.data?.alternatives;
  return Array.isArray(alts) ? alts : [];
}

export function friendlyBookingError(e: unknown): string {
  if (e instanceof ApiError) return FRIENDLY[e.code] ?? (e.status === 0 ? e.message : 'Something went wrong. Please try again.');
  return 'Something went wrong. Please try again.';
}

async function accessToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new BookingApiError(401, 'unauthorized', FRIENDLY.unauthorized);
  return token;
}

async function ownerPost<T>(path: string, body: unknown): Promise<T> {
  const token = await accessToken();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let status = 0;
  let raw = '';
  let ok = false;
  try {
    const resp = await fetch(`${base()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    status = resp.status;
    raw = await resp.text();
    ok = resp.ok;
  } catch {
    throw new BookingApiError(0, 'network', OFFLINE);
  } finally {
    clearTimeout(timer);
  }
  let data: any = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }
  if (!ok) {
    const code = typeof data?.error === 'string' && data.error ? data.error : `http-${status}`;
    throw new BookingApiError(status, code, FRIENDLY[code] ?? code, data);
  }
  return (data ?? {}) as T;
}

// ---- owner endpoints ------------------------------------------------------

export interface WalkInInput {
  memberId: string;
  serviceId: string;
  start: string; // ISO UTC
  customer: { name: string; phone?: string; email?: string };
  note?: string;
}

export function addBooking(input: WalkInInput): Promise<{ appointment: unknown }> {
  const customer = {
    name: input.customer.name,
    ...(input.customer.phone ? { phone: input.customer.phone } : {}),
    ...(input.customer.email ? { email: input.customer.email } : {}),
  };
  return ownerPost('/api/shop/appointments', { ...input, customer });
}

export function cancelBooking(id: string): Promise<{ appointment: unknown }> {
  return ownerPost(`/api/shop/appointments/${encodeURIComponent(id)}/cancel`, {});
}

export function rescheduleBooking(id: string, start: string, memberId?: string): Promise<{ appointment: unknown }> {
  return ownerPost(`/api/shop/appointments/${encodeURIComponent(id)}/reschedule`, {
    start,
    ...(memberId ? { memberId } : {}),
  });
}

export interface TimeOffConflict { id: string; start: string; customerName: string | null }

/** Inserts the time off; the conflicts come back either way so the app can ask first. */
export async function blockTime(input: {
  memberId: string; start: string; end: string; reason?: string; cancelConflicts?: boolean;
}): Promise<{ conflicts: TimeOffConflict[] }> {
  const out = await ownerPost<{ conflicts?: TimeOffConflict[] }>('/api/shop/time-off', {
    memberId: input.memberId,
    start: input.start,
    end: input.end,
    ...(input.reason ? { reason: input.reason } : {}),
    cancelConflicts: !!input.cancelConflicts,
  });
  return { conflicts: Array.isArray(out.conflicts) ? out.conflicts : [] };
}

export function postPushToken(expoToken: string): Promise<unknown> {
  return ownerPost('/api/shop/push-token', { expoToken, platform: 'ios' });
}

// ---- direct Supabase (RLS) ------------------------------------------------

const APPT_COLUMNS =
  'id, shop_id, member_id, service_id, start_at, end_at, service_name, price_cents, duration_min, ' +
  'customer_name, customer_phone, customer_email, note, status, payment_status, payment_method, ' +
  'amount_paid_cents, customer_says_paid_at, source';

export function toAppointment(r: any): Appointment {
  return {
    id: r.id,
    shopId: r.shop_id,
    memberId: r.member_id,
    serviceId: r.service_id ?? null,
    start: r.start_at,
    end: r.end_at,
    serviceName: r.service_name,
    priceCents: r.price_cents ?? null,
    durationMin: r.duration_min,
    customerName: r.customer_name ?? null,
    customerPhone: r.customer_phone ?? null,
    customerEmail: r.customer_email ?? null,
    note: r.note ?? null,
    status: r.status,
    paymentStatus: r.payment_status ?? 'none',
    paymentMethod: r.payment_method ?? null,
    amountPaidCents: r.amount_paid_cents ?? 0,
    customerSaysPaidAt: r.customer_says_paid_at ?? null,
    source: r.source ?? 'online',
  };
}

/** The shop's non-cancelled appointments starting in [fromIso, toIso). */
export async function listAppointments(shopId: string, fromIso: string, toIso: string): Promise<Appointment[]> {
  const { data, error } = await (supabase.from('ab_appointments') as any)
    .select(APPT_COLUMNS)
    .eq('shop_id', shopId)
    .neq('status', 'cancelled')
    .gte('start_at', fromIso)
    .lt('start_at', toIso)
    .order('start_at', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as any[]).map(toAppointment);
}

/** Time off of these barbers overlapping [fromIso, toIso). */
export async function listTimeOff(memberIds: string[], fromIso: string, toIso: string): Promise<TimeOff[]> {
  if (!memberIds.length) return [];
  const { data, error } = await (supabase.from('ab_time_off') as any)
    .select('id, member_id, start_at, end_at, reason')
    .in('member_id', memberIds)
    .lt('start_at', toIso)
    .gt('end_at', fromIso)
    .order('start_at', { ascending: true });
  if (error) throw error;
  return ((data ?? []) as any[]).map((r) => ({
    id: r.id, memberId: r.member_id, start: r.start_at, end: r.end_at, reason: r.reason ?? null,
  }));
}

function markAppointment(id: string, action: 'paid' | 'done' | 'no_show'): Promise<{ appointment: unknown }> {
  return ownerPost(`/api/shop/appointments/${encodeURIComponent(id)}/mark`, { action });
}

/** Cash, Cash App, Zelle…: the barber confirms the money arrived. Card payments are Stripe's to record. */
export async function markPaid(a: Pick<Appointment, 'id'>): Promise<void> {
  await markAppointment(a.id, 'paid');
}

export const markDone = async (id: string): Promise<void> => { await markAppointment(id, 'done'); };
export const markNoShow = async (id: string): Promise<void> => { await markAppointment(id, 'no_show'); };
