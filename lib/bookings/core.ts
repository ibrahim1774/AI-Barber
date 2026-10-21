// Shared pieces of the booking API flows: input validation, the bookings gate, schedule
// loading for the slot engine, response views and the one cancel routine every cancel path
// (customer, shop, time-off conflicts) goes through.
import { DateTime, IANAZone } from 'luxon';
import { freeSlotsAny, type AnySlot, type MemberSchedule } from './slots.js';
import { depositCents, refundOnCancel } from './money.js';
import { refundKey, type Notify, type Payments } from './deps.js';
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
  /** Cross-instance limits checked inside flows (absent = none, e.g. in most tests). */
  limits?: FlowLimits;
}

export interface FlowLimits {
  /** Count one online booking for the shop; false when over its hourly cap. Never throws. */
  shopBooking(shopId: string): Promise<boolean>;
}

export interface FlowResult {
  status: number;
  body: unknown;
  /** For non-JSON responses (the .ics feed). */
  contentType?: string;
  headers?: Record<string, string>;
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
// Hours 00-23, minutes/seconds 00-59 (no T24:00 rolling into the next day).
const ISO_INSTANT_RE = /^(\d{4})-(\d{2})-(\d{2})T([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,9}))?)?(Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);
export const isToken = (v: unknown): v is string => typeof v === 'string' && TOKEN_RE.test(v);
export const isSlugParam = (v: unknown): v is string => typeof v === 'string' && v.length <= 63 && SLUG_LOOKUP_RE.test(v);

/**
 * Epoch ms of an ISO instant with an explicit offset, else null. Strict: a date that does
 * not exist (Feb 30, Nov 31) is rejected rather than rolled over. `wholeMinute` (owner start
 * fields) also rejects seconds or milliseconds off the minute.
 */
export function parseInstant(v: unknown, opts: { wholeMinute?: boolean } = {}): number | null {
  if (typeof v !== 'string') return null;
  const m = ISO_INSTANT_RE.exec(v);
  if (!m) return null;
  const dt = DateTime.fromISO(v, { setZone: true });
  if (!dt.isValid) return null;
  // Every field must read back unchanged in the input's own offset (no silent rollover).
  if (dt.year !== +m[1] || dt.month !== +m[2] || dt.day !== +m[3] || dt.hour !== +m[4] || dt.minute !== +m[5]) return null;
  if (opts.wholeMinute && (dt.second !== 0 || dt.millisecond !== 0 || (m[7] && /[1-9]/.test(m[7])))) return null;
  const ms = dt.toMillis();
  return Number.isFinite(ms) ? ms : null;
}

export const iso = (ms: number) => new Date(ms).toISOString();

// Line breaks and tabs become spaces; every other C0/C1 control character is dropped, so
// nothing control-y reaches S2's email, push or ICS text.
const LINE_BREAKS_RE = /[\t\n\v\f\r\u0085\u2028\u2029]+/g;
const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F]/g;

export function stripControls(v: string): string {
  return v.replace(LINE_BREAKS_RE, ' ').replace(CONTROL_RE, '');
}

/**
 * Trimmed text of 1..max chars (or 0..max when optional), else undefined. Null/absent
 * optional -> null. Control characters are removed first (line breaks collapse to a space),
 * so a value made only of control characters counts as empty.
 */
export function text(v: unknown, max: number, optional = false): string | null | undefined {
  if (v == null || v === '') return optional ? null : undefined;
  if (typeof v !== 'string') return undefined;
  const t = stripControls(v).trim();
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

/**
 * What a cancel by `by` at `nowMs` would refund automatically (card payments only, spec §10).
 * A booking the shop has moved (shop_rescheduled_at set) refunds as if the shop cancelled,
 * even when the customer cancels it; the row still records cancelled_by 'customer'.
 */
export function refundIfCancelled(shop: ShopRow, appt: AppointmentRow, by: 'customer' | 'shop', nowMs: number): number {
  if (appt.payment_method !== 'card') return 0; // manual rails / in shop: no automatic money movement
  const amount = refundable(appt);
  if (amount <= 0) return 0;
  const refundAs = appt.shop_rescheduled_at ? 'shop' : by;
  return refundOnCancel({ by: refundAs, cutoffMin: shop.cancel_cutoff_min, startAt: appt.start_at, now: iso(nowMs), amountPaidCents: amount });
}

export async function safeNotify(deps: FlowDeps, event: Parameters<Notify>[0]): Promise<void> {
  try {
    await deps.notify(event);
  } catch (e: any) {
    console.error('[bookings] notify failed:', e?.message || e);
  }
}

async function safeLog(deps: Pick<FlowDeps, 'repo'>, shopId: string, kind: string, payload: Record<string, unknown>) {
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
  if (isUnpaidCardHold(row) && row.stripe_checkout_session_id) {
    // Nothing was paid: close the Checkout so it can't be paid now (S2's webhook still
    // refunds in full if a payment slips through, because the booking is cancelled).
    try {
      await deps.payments.expireCheckoutSession(shop, row.stripe_checkout_session_id);
    } catch (e: any) {
      console.error(`[bookings] expiring checkout for ${row.id} failed:`, e?.message || e);
    }
  }
  // What the cancel owes, from the row the claim returned (never an earlier read). Recorded
  // as an absolute target total in refund_due_cents before Stripe is called, so a refund
  // that fails or times out is retried by retryPendingRefunds instead of being lost.
  const toRefund = refundIfCancelled(shop, row, by, nowMs);
  let refunded = 0;
  if (toRefund > 0) {
    const due = row.amount_refunded_cents + toRefund;
    try {
      const d = await deps.repo.updateAppointment(row.id, { refund_due_cents: due }, { status: 'cancelled' });
      if (d.ok) row = d.row;
    } catch (e: any) {
      console.error(`[bookings] recording refund due for ${row.id} failed:`, e?.message || e);
    }
    const r = await refundOwed(deps, shop, row, toRefund, { by }, true);
    refunded = r.refunded;
    row = r.row;
  }
  await safeNotify(deps, { kind: 'booking_cancelled', appointmentId: row.id, by, refundedCents: refunded });
  return { appt: row, refundedCents: refunded, alreadyFinal: false };
}

/**
 * Refund `amount` of a cancelled booking under the one cancel key (refundKey.cancel(id)), so
 * a retry after a lost response returns the same Stripe refund instead of a second one. On
 * success writes amount_refunded_cents as an absolute total under the monotonic lte guard
 * (never an increment). On failure the row stays pending; 'refund_failed' goes to ab_events
 * only for the first attempt (`logEvent`), retries just log to the console.
 */
async function refundOwed(
  deps: RefundSweepDeps,
  shop: ShopRow,
  row: AppointmentRow,
  amount: number,
  ctx: Record<string, unknown>,
  logEvent: boolean,
): Promise<{ refunded: number; row: AppointmentRow; failed: boolean }> {
  let refunded = 0;
  try {
    const r = await deps.payments.refundAppointment(shop, row, amount, { idempotencyKey: refundKey.cancel(row.id) });
    refunded = Math.max(0, Math.min(amount, Math.floor(Number(r?.refundedCents) || 0)));
  } catch (e: any) {
    console.error(`[bookings] refund failed for appointment ${row.id} (left pending for retry):`, e?.message || e);
    if (logEvent) await safeLog(deps, shop.id, 'refund_failed', { appointmentId: row.id, amountCents: amount, ...ctx, error: String(e?.message || e) });
    return { refunded: 0, row, failed: true };
  }
  if (refunded > 0) {
    // S2's charge.refunded webhook writes Stripe's cumulative total under the same guard, so
    // whichever lands last can't double count or lower it.
    const total = row.amount_refunded_cents + refunded;
    try {
      const upd = await deps.repo.updateAppointment(row.id, {
        amount_refunded_cents: total,
        payment_status: total >= row.amount_paid_cents ? 'refunded' : 'partially_refunded',
      }, { refundedLte: total });
      row = upd.ok ? upd.row : (await deps.repo.appointmentById(row.id)) ?? row;
    } catch (e: any) {
      console.error(`[bookings] refund bookkeeping failed for appointment ${row.id}:`, e?.message || e);
    }
  }
  return { refunded, row, failed: false };
}

// ---------------------------------------------------------------------------
// Pending cancel refunds
// ---------------------------------------------------------------------------
export const REFUND_RETRY_AFTER_MIN = 2;
/** Inside Stripe's 24 h idempotency window, so a retry can never become a second refund. */
export const REFUND_GIVE_UP_HOURS = 23;
export const REFUND_RETRY_BATCH = 25;

export interface RefundSweepDeps {
  repo: BookingRepo;
  payments: Pick<Payments, 'refundAppointment'>;
}

/**
 * Retry cancel refunds that are still owed: cancelled rows with refund_due_cents >
 * amount_refunded_cents, not stuck, with a payment intent, last touched more than 2 minutes
 * ago, at most 25 per run. Each retry uses the same refundKey.cancel(id) key and amount
 * (due - refunded) as the first attempt, so if that one actually went through at Stripe the
 * same refund comes back and nothing is refunded twice. Retries stop 23 hours after the cancel
 * (inside Stripe's 24 h idempotency window): the row gets refund_stuck_at and one ab_events
 * 'refund_stuck' row; refund_due_cents is never lowered, so the debt stays visible.
 * Exported for S2's reminders cron.
 */
export async function retryPendingRefunds(
  deps: RefundSweepDeps,
  nowMs: number = Date.now(),
): Promise<{ retried: number; refunded: number; failed: number; stuck: number }> {
  const out = { retried: 0, refunded: 0, failed: 0, stuck: 0 };
  const rows = await deps.repo.pendingRefunds(iso(nowMs - REFUND_RETRY_AFTER_MIN * MIN), REFUND_RETRY_BATCH);
  for (const row of rows) {
    try {
      const owed = row.refund_due_cents - row.amount_refunded_cents;
      if (owed <= 0 || row.status !== 'cancelled') continue;
      const since = Date.parse(row.cancelled_at ?? row.updated_at ?? '');
      if (Number.isFinite(since) && nowMs - since >= REFUND_GIVE_UP_HOURS * 60 * MIN) {
        const marked = await deps.repo.updateAppointment(row.id, { refund_stuck_at: iso(nowMs) }, { status: 'cancelled', notStuck: true });
        if (marked.ok === false) continue; // another run marked it
        await safeLog(deps, row.shop_id, 'refund_stuck', {
          appointmentId: row.id, dueCents: row.refund_due_cents, refundedCents: row.amount_refunded_cents,
          owedCents: owed, paymentIntent: row.stripe_payment_intent_id, cancelledAt: row.cancelled_at,
        });
        console.error(`[bookings] refund for ${row.id} still owed ${REFUND_GIVE_UP_HOURS} h after the cancel; giving up (refund_stuck)`);
        out.stuck++;
        continue;
      }
      const shop = await deps.repo.shopById(row.shop_id);
      if (!shop) continue;
      out.retried++;
      const r = await refundOwed(deps, shop, row, owed, { retry: true }, false);
      if (r.failed) {
        out.failed++;
        // Touch the row so the next run tries the others first (and waits 2 minutes for this one).
        await deps.repo.updateAppointment(row.id, { refund_due_cents: row.refund_due_cents }, { status: 'cancelled' });
      } else if (r.refunded > 0) out.refunded++;
    } catch (e: any) {
      console.error(`[bookings] retrying refund for ${row.id} failed:`, e?.message || e);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Orphaned card holds
// ---------------------------------------------------------------------------
/** A card hold older than this with nothing paid is expired (Checkout itself lasts 30 min). */
export const CARD_HOLD_EXPIRY_MIN = 35;

export interface SweepDeps {
  repo: BookingRepo;
  payments: Pick<Payments, 'expireCheckoutSession'>;
  now(): number;
}

/**
 * Expire orphaned card holds: booked + card + awaiting + nothing paid, created more than
 * 35 minutes ago (e.g. the function died between the insert and Checkout, so no
 * checkout.session.expired webhook will ever come). Same fields as S2's expireHold
 * (cancelled_by 'customer', payment_status 'none'), under a compare-and-set so a payment
 * that lands mid-sweep is never overwritten. Never refunds and never notifies (the customer
 * was never confirmed). Exported for S2's reminders cron to call at merge.
 */
export async function expireStaleCardHolds(deps: SweepDeps, limit = 200): Promise<{ expired: number }> {
  const nowMs = deps.now();
  const holds = await deps.repo.staleCardHolds(iso(nowMs - CARD_HOLD_EXPIRY_MIN * MIN), limit);
  let expired = 0;
  for (const h of holds) {
    try {
      const upd = await deps.repo.updateAppointment(
        h.id,
        { status: 'cancelled', cancelled_by: 'customer', cancelled_at: iso(nowMs), payment_status: 'none' },
        { status: 'booked', method: 'card', paymentStatusIn: ['awaiting'], paidCents: 0 },
      );
      if (upd.ok === false) continue;
      expired++;
      if (upd.row.stripe_checkout_session_id) {
        const shop = await deps.repo.shopById(upd.row.shop_id);
        if (shop) {
          try {
            await deps.payments.expireCheckoutSession(shop, upd.row.stripe_checkout_session_id);
          } catch (e: any) {
            console.error(`[bookings] expiring checkout for ${upd.row.id} failed:`, e?.message || e);
          }
        }
      }
    } catch (e: any) {
      console.error(`[bookings] expiring card hold ${h.id} failed:`, e?.message || e);
    }
  }
  return { expired };
}

export { MIN, DAY };
