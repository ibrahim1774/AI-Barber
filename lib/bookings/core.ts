// Shared pieces of the booking API flows: input validation, the bookings gate, schedule
// loading for the slot engine, response views and the one cancel routine every cancel path
// (customer, shop, time-off conflicts) goes through.
import { DateTime, IANAZone } from 'luxon';
import { freeSlotsAny, type AnySlot, type MemberSchedule } from './slots.js';
import { depositCents, refundOnCancel } from './money.js';
import type { Notify, Payments } from './deps.js';
import {
  MANUAL_METHODS,
  type AppointmentRow,
  type BookingRepo,
  type ManualHandles,
  type MemberRow,
  type ServiceMemberRow,
  type ServiceRow,
  type ShopRow,
} from './repo.js';

export interface FlowDeps {
  repo: BookingRepo;
  payments: Payments;
  notify: Notify;
  now(): number;
  /** Origin of the booking pages, e.g. 'https://www.aibarber.org'. */
  baseUrl: string;
}

export interface FlowResult {
  status: number;
  body: unknown;
  /** For non-JSON responses (the .ics feed). */
  contentType?: string;
}

export const ok = (body: unknown, status = 200): FlowResult => ({ status, body });
export const err = (status: number, error: string, extra: Record<string, unknown> = {}): FlowResult => ({
  status,
  body: { error, ...extra },
});
export const invalid = (field: string) => err(400, 'invalid', { field });
export const paused = () => err(423, 'bookings-paused');
export const notFound = () => err(404, 'not-found');

const MIN = 60_000;
const DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const TOKEN_RE = /^[A-Za-z0-9_-]{32,128}$/;
const SLUG_LOOKUP_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
// An explicit offset is required: a bare local time would be read in the server's zone.
const ISO_INSTANT_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
export const isToken = (v: unknown): v is string => typeof v === 'string' && TOKEN_RE.test(v);
export const isSlugParam = (v: unknown): v is string => typeof v === 'string' && v.length <= 63 && SLUG_LOOKUP_RE.test(v);

/** Epoch ms of an ISO instant with an explicit offset, else null. */
export function parseInstant(v: unknown): number | null {
  if (typeof v !== 'string' || !ISO_INSTANT_RE.test(v)) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : null;
}

export const iso = (ms: number) => new Date(ms).toISOString();

/** Trimmed text of 1..max chars (or 0..max when optional), else undefined. Null/absent optional -> null. */
export function text(v: unknown, max: number, optional = false): string | null | undefined {
  if (v == null || v === '') return optional ? null : undefined;
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (!t) return optional ? null : undefined;
  return t.length <= max ? t : undefined;
}

/** Digits-only phone for comparison (a leading US/CA "1" on 11 digits dropped), or null if implausible. */
export function normalizePhone(v: unknown): string | null {
  if (typeof v !== 'string' || v.length > 40) return null;
  let d = v.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d.length >= 7 && d.length <= 15 ? d : null;
}

export function validEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length <= 254 && EMAIL_RE.test(t) ? t : null;
}

export function validZone(tz: unknown): tz is string {
  return typeof tz === 'string' && tz.length > 0 && IANAZone.isValidZone(tz);
}

export function manualHandles(shop: ShopRow): ManualHandles {
  const out: ManualHandles = {};
  const h = isObj(shop.manual_handles) ? shop.manual_handles : {};
  for (const k of MANUAL_METHODS) {
    const v = (h as Record<string, unknown>)[k];
    if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  }
  return out;
}

export const cardEnabled = (shop: ShopRow) => !!shop.stripe_charges_enabled && !!shop.stripe_account_id;

// ---------------------------------------------------------------------------
// Bookings gate
// ---------------------------------------------------------------------------
/**
 * Public booking is open when bookings_enabled AND the linked iOS purchase exists, is not
 * revoked and not taken down. A shop whose timezone is not a valid IANA zone is treated as
 * paused (logged) instead of letting the slot engine throw a 500.
 */
export async function bookingsOpen(repo: BookingRepo, shop: ShopRow): Promise<boolean> {
  if (!shop.bookings_enabled) return false;
  if (!validZone(shop.timezone)) {
    console.error(`[bookings] shop ${shop.id} has an invalid timezone '${shop.timezone}'; treating as paused`);
    return false;
  }
  if (!shop.ios_otid) return false;
  const p = await repo.purchase(shop.ios_otid);
  return !!p && !p.revoked_at && !p.taken_down_at;
}

// ---------------------------------------------------------------------------
// Catalog + schedules
// ---------------------------------------------------------------------------
export interface Catalog {
  services: ServiceRow[];
  members: MemberRow[]; // active only, in sort order
  links: ServiceMemberRow[];
}

export async function loadCatalog(repo: BookingRepo, shop: ShopRow): Promise<Catalog> {
  const [services, members] = await Promise.all([repo.services(shop.id), repo.members(shop.id)]);
  const activeMembers = members.filter((m) => m.active && m.shop_id === shop.id);
  const shopServices = services.filter((s) => s.shop_id === shop.id);
  const links = await repo.serviceMembers(shopServices.map((s) => s.id));
  return { services: shopServices, members: activeMembers, links };
}

/** No ab_service_members rows for a service = every active member offers it. */
export function offers(cat: Catalog, serviceId: string, memberId: string): boolean {
  const rows = cat.links.filter((l) => l.service_id === serviceId);
  return rows.length === 0 || rows.some((l) => l.member_id === memberId);
}

/** A service of this shop that customers may book (active + bookable), else null. */
export function bookableService(cat: Catalog, serviceId: unknown): ServiceRow | null {
  if (!isUuid(serviceId)) return null;
  return cat.services.find((s) => s.id === serviceId && s.active && s.bookable) ?? null;
}

/** Active members of this shop offering the service: all of them ('any') or the one asked for. Null = invalid. */
export function candidateMembers(cat: Catalog, service: ServiceRow, memberId: unknown): MemberRow[] | null {
  const eligible = cat.members.filter((m) => offers(cat, service.id, m.id));
  if (memberId === 'any') return eligible;
  if (!isUuid(memberId)) return null;
  const m = eligible.find((x) => x.id === memberId);
  return m ? [m] : null;
}

export function priceFor(cat: Catalog, service: ServiceRow, memberId: string): number | null {
  const o = cat.links.find((l) => l.service_id === service.id && l.member_id === memberId)?.price_override_cents;
  return o != null ? o : service.price_cents;
}

export const serviceDeposit = (service: ServiceRow, price: number | null) =>
  depositCents(price, service.deposit_type, service.deposit_value);

/** Each member's availability, time off and busy times overlapping [fromMs, toMs). */
export async function loadSchedules(
  repo: BookingRepo,
  members: MemberRow[],
  fromMs: number,
  toMs: number,
  excludeAppointmentId?: string,
): Promise<MemberSchedule[]> {
  const ids = members.map((m) => m.id);
  if (ids.length === 0) return [];
  const [avail, off, busy] = await Promise.all([
    repo.availability(ids),
    repo.timeOff(ids, iso(fromMs), iso(toMs)),
    repo.busy(ids, iso(fromMs), iso(toMs)),
  ]);
  return members.map((m) => ({
    id: m.id,
    availability: avail.filter((a) => a.member_id === m.id),
    timeOff: off.filter((t) => t.member_id === m.id).map((t) => ({ start: t.start_at, end: t.end_at })),
    busy: busy
      .filter((b) => b.member_id === m.id && b.id !== excludeAppointmentId)
      .map((b) => ({ start: b.start_at, end: b.end_at })),
  }));
}

export interface Rules {
  minNoticeMin: number;
  leadDays: number | undefined;
}

export const publicRules = (shop: ShopRow): Rules => ({ minNoticeMin: shop.min_notice_min, leadDays: shop.lead_days });
/** Owner actions skip minimum notice and lead days (alternatives still look 60 days ahead). */
export const ownerRules: Rules = { minNoticeMin: 0, leadDays: undefined };

export function localDate(ms: number, zone: string): string {
  return DateTime.fromMillis(ms, { zone }).toISODate()!;
}

/** [start, end) instants of a shop-local calendar date. */
export function localDayBounds(date: string, zone: string): [number, number] {
  const d = DateTime.fromISO(date, { zone }).startOf('day');
  return [d.toMillis(), d.plus({ days: 1 }).toMillis()];
}

/** Free starts on one shop-local date across `scheds` (first member in order wins a shared start). */
export function daySlots(shop: ShopRow, durationMin: number, date: string, scheds: MemberSchedule[], nowMs: number, rules: Rules): AnySlot[] {
  if (scheds.length === 0) return [];
  return freeSlotsAny(
    {
      timezone: shop.timezone,
      date,
      durationMin,
      bufferMin: shop.buffer_min,
      stepMin: shop.slot_step_min,
      minNoticeMin: rules.minNoticeMin,
      leadDays: rules.leadDays,
      now: iso(nowMs),
    },
    scheds,
  );
}

/** Members (in candidate order) for whom `startMs` is a free slot under `rules`. */
export async function membersFreeAt(
  repo: BookingRepo,
  shop: ShopRow,
  members: MemberRow[],
  durationMin: number,
  startMs: number,
  nowMs: number,
  rules: Rules,
  excludeAppointmentId?: string,
): Promise<MemberRow[]> {
  const date = localDate(startMs, shop.timezone);
  const [dayStart, dayEnd] = localDayBounds(date, shop.timezone);
  const scheds = await loadSchedules(repo, members, dayStart - DAY, dayEnd + DAY, excludeAppointmentId);
  const free: MemberRow[] = [];
  for (const s of scheds) {
    const slots = daySlots(shop, durationMin, date, [s], nowMs, rules);
    if (slots.some((x) => Date.parse(x.start) === startMs)) free.push(members.find((m) => m.id === s.id)!);
  }
  return free;
}

const MAX_ALT_DAYS = 62;

/** The next `count` free starts strictly after `afterMs` (one batched schedule load). */
export async function alternatives(
  repo: BookingRepo,
  shop: ShopRow,
  members: MemberRow[],
  durationMin: number,
  afterMs: number,
  nowMs: number,
  rules: Rules,
  excludeAppointmentId?: string,
  count = 3,
): Promise<AnySlot[]> {
  if (members.length === 0) return [];
  const zone = shop.timezone;
  const from = Math.max(afterMs, nowMs);
  const firstDate = localDate(from, zone);
  const days = Math.min(MAX_ALT_DAYS, rules.leadDays != null ? rules.leadDays + 2 : MAX_ALT_DAYS);
  const lastDate = DateTime.fromISO(firstDate, { zone: 'utc' }).plus({ days }).toISODate()!;
  const [rangeStart] = localDayBounds(firstDate, zone);
  const [, rangeEnd] = localDayBounds(lastDate, zone);
  const scheds = await loadSchedules(repo, members, rangeStart - DAY, rangeEnd + DAY, excludeAppointmentId);
  const out: AnySlot[] = [];
  let d = DateTime.fromISO(firstDate, { zone: 'utc' });
  for (let i = 0; i <= days && out.length < count; i++, d = d.plus({ days: 1 })) {
    for (const s of daySlots(shop, durationMin, d.toISODate()!, scheds, nowMs, rules)) {
      if (Date.parse(s.start) > afterMs) out.push(s);
      if (out.length >= count) break;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------
export const manageUrl = (baseUrl: string, token: string) =>
  `${baseUrl.replace(/\/+$/, '')}/book/manage/${encodeURIComponent(token)}`;

export function manageView(appt: AppointmentRow, memberName: string, shop: ShopRow) {
  return {
    id: appt.id,
    start: iso(Date.parse(appt.start_at)),
    end: iso(Date.parse(appt.end_at)),
    status: appt.status,
    serviceId: appt.service_id,
    serviceName: appt.service_name,
    memberId: appt.member_id,
    memberName,
    priceCents: appt.price_cents,
    amountPaidCents: appt.amount_paid_cents,
    paymentStatus: appt.payment_status,
    shop: { name: shop.name, slug: shop.slug, address: shop.address, phone: shop.phone, timezone: shop.timezone },
  };
}

export function ownerView(appt: AppointmentRow, memberName: string) {
  return {
    id: appt.id,
    start: iso(Date.parse(appt.start_at)),
    end: iso(Date.parse(appt.end_at)),
    status: appt.status,
    serviceId: appt.service_id,
    serviceName: appt.service_name,
    memberId: appt.member_id,
    memberName,
    priceCents: appt.price_cents,
    amountPaidCents: appt.amount_paid_cents,
    amountRefundedCents: appt.amount_refunded_cents,
    paymentStatus: appt.payment_status,
    paymentMethod: appt.payment_method,
    source: appt.source,
    customer: { name: appt.customer_name, phone: appt.customer_phone, email: appt.customer_email },
    note: appt.note,
    cancelledBy: appt.cancelled_by,
  };
}

export async function memberName(repo: BookingRepo, shopId: string, memberId: string): Promise<string> {
  const m = (await repo.members(shopId)).find((x) => x.id === memberId);
  return m?.display_name ?? '';
}

// ---------------------------------------------------------------------------
// Money + cancel
// ---------------------------------------------------------------------------
/** A card booking whose Checkout has not been paid yet (a 30-minute hold). */
export const isUnpaidCardHold = (a: AppointmentRow) =>
  a.payment_method === 'card' && a.payment_status === 'awaiting' && a.amount_paid_cents === 0;

const refundable = (a: AppointmentRow) => Math.max(0, (a.amount_paid_cents ?? 0) - (a.amount_refunded_cents ?? 0));

/** What a cancel by `by` at `nowMs` would refund automatically (card payments only, spec §10). */
export function refundIfCancelled(shop: ShopRow, appt: AppointmentRow, by: 'customer' | 'shop', nowMs: number): number {
  if (appt.payment_method !== 'card') return 0; // manual rails / in shop: no automatic money movement
  const amount = refundable(appt);
  if (amount <= 0) return 0;
  return refundOnCancel({ by, cutoffMin: shop.cancel_cutoff_min, startAt: appt.start_at, now: iso(nowMs), amountPaidCents: amount });
}

export async function safeNotify(deps: FlowDeps, event: Parameters<Notify>[0]): Promise<void> {
  try {
    await deps.notify(event);
  } catch (e: any) {
    console.error('[bookings] notify failed:', e?.message || e);
  }
}

async function safeLog(deps: FlowDeps, shopId: string, kind: string, payload: Record<string, unknown>) {
  try {
    await deps.repo.logEvent(shopId, kind, payload);
  } catch (e: any) {
    console.error('[bookings] logEvent failed:', e?.message || e);
  }
}

export interface CancelOutcome {
  appt: AppointmentRow;
  refundedCents: number;
  /** The appointment was no longer 'booked' (already cancelled / done): nothing was done. */
  alreadyFinal: boolean;
}

/**
 * The single cancel path. Claims the row first (update ... where status = 'booked'), so a
 * double tap or a race can never refund twice; then refunds per spec §10 (card only; the
 * shop always refunds everything still refundable, a customer only up to the cutoff);
 * then notifies. A refund failure is logged (ab_events 'refund_failed') for follow-up and
 * never un-cancels the booking.
 */
export async function cancelAppointment(
  deps: FlowDeps,
  shop: ShopRow,
  appt: AppointmentRow,
  by: 'customer' | 'shop',
): Promise<CancelOutcome> {
  const nowMs = deps.now();
  const claim = await deps.repo.updateAppointment(
    appt.id,
    { status: 'cancelled', cancelled_by: by, cancelled_at: iso(nowMs) },
    'booked',
  );
  if (claim.ok === false) {
    const cur = (await deps.repo.appointmentById(appt.id)) ?? appt;
    return { appt: cur, refundedCents: 0, alreadyFinal: true };
  }
  let row = claim.row;
  const toRefund = refundIfCancelled(shop, row, by, nowMs);
  let refunded = 0;
  if (toRefund > 0) {
    try {
      const r = await deps.payments.refundAppointment(shop, row, toRefund);
      refunded = Math.max(0, Math.min(toRefund, Math.floor(Number(r?.refundedCents) || 0)));
    } catch (e: any) {
      console.error(`[bookings] refund failed for appointment ${row.id}:`, e?.message || e);
      await safeLog(deps, shop.id, 'refund_failed', { appointmentId: row.id, amountCents: toRefund, by, error: String(e?.message || e) });
    }
    if (refunded > 0) {
      const total = row.amount_refunded_cents + refunded;
      try {
        const upd = await deps.repo.updateAppointment(row.id, {
          amount_refunded_cents: total,
          payment_status: total >= row.amount_paid_cents ? 'refunded' : 'partially_refunded',
        });
        if (upd.ok) row = upd.row;
      } catch (e: any) {
        console.error(`[bookings] refund bookkeeping failed for appointment ${row.id}:`, e?.message || e);
      }
    }
  }
  const name = await memberName(deps.repo, shop.id, row.member_id);
  await safeNotify(deps, { kind: 'booking_cancelled', by, shop, appt: row, memberName: name, refundedCents: refunded });
  return { appt: row, refundedCents: refunded, alreadyFinal: false };
}

export { MIN, DAY };
