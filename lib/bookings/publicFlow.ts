// Public booking API flows (no auth): /api/book/{shop,days,slots,appointments,manage,sent,ics}.
// Pure over injected deps (repo, payments, notify, clock), so they are testable without
// Supabase or Stripe. Handlers in api/book/* only parse the request and send the result.
import { DateTime } from 'luxon';
import {
  alternatives,
  bookableService,
  bookingsFollowUpOpen,
  bookingsOpen,
  cancelAppointment,
  candidateMembers,
  cardEnabled,
  daySlots,
  err,
  invalid,
  isObj,
  isSlugParam,
  isToken,
  isUnpaidCardHold,
  iso,
  loadCatalog,
  loadSchedules,
  localDayBounds,
  manageUrl,
  manageView,
  manualHandles,
  memberName,
  membersFreeAt,
  normalizePhone,
  notFound,
  inShopAllowed,
  offers,
  ok,
  parseInstant,
  paused,
  priceFor,
  publicRules,
  refundIfCancelled,
  safeNotify,
  serviceDeposit,
  text,
  validEmail,
  validZone,
  DAY,
  MIN,
  type Catalog,
  type FlowDeps,
  type FlowResult,
} from './core.js';
import { appointmentsToIcs } from './deps.js';
import { customerOrigin, siteField } from '../customerUrls.js';
import {
  MANUAL_METHODS,
  type AppointmentRow,
  type ManualMethod,
  type MemberRow,
  type NewAppointment,
  type PaymentStatus,
  type ShopRow,
} from './repo.js';

type Params = Record<string, unknown>;

const STRIPE_MIN_CENTS = 50;

async function shopForSlug(deps: FlowDeps, slug: unknown): Promise<ShopRow | null> {
  if (!isSlugParam(slug)) return null;
  return deps.repo.shopBySlug(slug);
}

// ---------------------------------------------------------------------------
// GET /api/book/shop?slug=
// ---------------------------------------------------------------------------
export async function getShop(params: Params, deps: FlowDeps): Promise<FlowResult> {
  const shop = await shopForSlug(deps, params.slug);
  if (!shop) return notFound();
  // site: the shop's own site and look, for the page's header and styling (absent without one).
  const site = siteField(shop);
  if (!(await bookingsOpen(deps.repo, shop))) return ok({ paused: true, shop: { name: shop.name }, ...site });

  const cat = await loadCatalog(deps.repo, shop);
  const services = cat.services.filter((s) => s.active && s.bookable);
  const members = cat.members.filter((m) => services.some((s) => offers(cat, s.id, m.id)));
  return ok({
    paused: false,
    shop: {
      slug: shop.slug,
      name: shop.name,
      timezone: shop.timezone,
      address: shop.address ?? null,
      phone: shop.phone ?? null,
      accent: shop.accent ?? null,
      cancelCutoffMin: shop.cancel_cutoff_min,
      pay: { inShop: inShopAllowed(shop), card: cardEnabled(shop), manual: manualHandles(shop) },
    },
    services: services.map((s) => ({
      id: s.id,
      name: s.name,
      priceCents: s.price_cents,
      durationMin: s.duration_min,
      description: s.description ?? null,
      photoUrl: s.photo_url ?? null,
      depositCents: serviceDeposit(s, s.price_cents),
    })),
    members: members.map((m) => {
      const ids = services.filter((s) => offers(cat, s.id, m.id)).map((s) => s.id);
      return {
        id: m.id,
        name: m.display_name,
        photoUrl: m.photo_url ?? null,
        bio: m.bio ?? null,
        serviceIds: ids.length === services.length ? null : ids,
      };
    }),
    ...site,
  });
}

// ---------------------------------------------------------------------------
// Shared resolution for days / slots / appointments
// ---------------------------------------------------------------------------
type Resolved =
  | { ok: true; shop: ShopRow; cat: Catalog; service: Catalog['services'][number]; members: MemberRow[] }
  | { ok: false; result: FlowResult };

async function resolve(deps: FlowDeps, slug: unknown, serviceId: unknown, memberId: unknown): Promise<Resolved> {
  if (!isSlugParam(slug)) return { ok: false, result: invalid('slug') };
  const shop = await deps.repo.shopBySlug(slug);
  if (!shop) return { ok: false, result: notFound() };
  if (!(await bookingsOpen(deps.repo, shop))) return { ok: false, result: paused() };
  const cat = await loadCatalog(deps.repo, shop);
  const service = bookableService(cat, serviceId);
  if (!service) return { ok: false, result: invalid('serviceId') };
  const members = candidateMembers(cat, service, memberId);
  if (!members) return { ok: false, result: invalid('memberId') };
  return { ok: true, shop, cat, service, members };
}

// ---------------------------------------------------------------------------
// GET /api/book/days?slug=&serviceId=&memberId=&month=YYYY-MM
// ---------------------------------------------------------------------------
export async function getDays(params: Params, deps: FlowDeps): Promise<FlowResult> {
  const month = typeof params.month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month) ? params.month : null;
  if (!month) return invalid('month');
  const r = await resolve(deps, params.slug, params.serviceId, params.memberId);
  if (r.ok === false) return r.result;
  const { shop, service, members } = r;
  const zone = shop.timezone;
  const nowMs = deps.now();
  const first = DateTime.fromISO(`${month}-01`, { zone: 'utc' });
  const daysInMonth = first.daysInMonth!;
  const today = DateTime.fromISO(DateTime.fromMillis(nowMs, { zone }).toISODate()!, { zone: 'utc' });
  const lastBookable = today.plus({ days: shop.lead_days });

  const days: Record<string, true> = {};
  const lo = first < today ? today : first;
  const hi = first.plus({ days: daysInMonth - 1 }) < lastBookable ? first.plus({ days: daysInMonth - 1 }) : lastBookable;
  if (lo <= hi && members.length > 0) {
    const [rangeStart] = localDayBounds(lo.toISODate()!, zone);
    const [, rangeEnd] = localDayBounds(hi.toISODate()!, zone);
    const scheds = await loadSchedules(deps.repo, members, rangeStart - DAY, rangeEnd + DAY);
    for (let d = lo; d <= hi; d = d.plus({ days: 1 })) {
      const date = d.toISODate()!;
      if (daySlots(shop, service.duration_min, date, scheds, nowMs, publicRules(shop)).length > 0) days[date] = true;
    }
  }
  return ok({ days, timezone: zone });
}

// ---------------------------------------------------------------------------
// GET /api/book/slots?slug=&serviceId=&memberId=&date=YYYY-MM-DD
// ---------------------------------------------------------------------------
export async function getSlots(params: Params, deps: FlowDeps): Promise<FlowResult> {
  const date = typeof params.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : null;
  if (!date || !DateTime.fromISO(date, { zone: 'utc' }).isValid) return invalid('date');
  const r = await resolve(deps, params.slug, params.serviceId, params.memberId);
  if (r.ok === false) return r.result;
  const { shop, service, members } = r;
  const [dayStart, dayEnd] = localDayBounds(date, shop.timezone);
  const scheds = await loadSchedules(deps.repo, members, dayStart - DAY, dayEnd + DAY);
  const slots = daySlots(shop, service.duration_min, date, scheds, deps.now(), publicRules(shop));
  return ok({ slots });
}

// ---------------------------------------------------------------------------
// POST /api/book/appointments
// ---------------------------------------------------------------------------
type Pay = 'shop' | 'manual' | 'card';

export async function createAppointment(body: unknown, deps: FlowDeps): Promise<FlowResult> {
  if (!isObj(body)) return invalid('body');
  const { slug, serviceId, memberId, start, customer, note, pay, method } = body;
  if (!isSlugParam(slug)) return invalid('slug');
  if (!(memberId === 'any' || typeof memberId === 'string')) return invalid('memberId');
  const startMs = parseInstant(start);
  if (startMs == null) return invalid('start');
  if (!isObj(customer)) return invalid('customer');
  const name = text(customer.name, 100);
  if (!name) return invalid('customer.name');
  const phoneKey = normalizePhone(customer.phone);
  if (!phoneKey) return invalid('customer.phone');
  const phone = (customer.phone as string).trim();
  const email = validEmail(customer.email);
  if (!email) return invalid('customer.email');
  const noteText = text(note, 500, true);
  if (noteText === undefined) return invalid('note');
  if (pay !== 'shop' && pay !== 'manual' && pay !== 'card') return invalid('pay');
  if (method != null && (pay !== 'manual' || !MANUAL_METHODS.includes(method as ManualMethod))) return invalid('method');

  const r = await resolve(deps, slug, serviceId, memberId);
  if (r.ok === false) return r.result;
  const { shop, cat, service } = r;
  const nowMs = deps.now();

  // Payment method must be one the shop offers.
  if (pay === 'shop' && !inShopAllowed(shop)) return invalid('pay');
  if (pay === 'manual' && Object.keys(manualHandles(shop)).length === 0) return invalid('pay');
  if (pay === 'card' && !cardEnabled(shop)) return invalid('pay');
  // The manual rail is fixed at booking time (POST /sent must name the same one): the one
  // asked for, else the shop's only handle. With several handles and none named it stays
  // null, and "I've sent it" is refused for that booking.
  let manualMethod: ManualMethod | null = null;
  if (pay === 'manual') {
    const offered = Object.keys(manualHandles(shop)) as ManualMethod[];
    if (method != null && !offered.includes(method as ManualMethod)) return invalid('method');
    manualMethod = (method as ManualMethod | undefined) ?? (offered.length === 1 ? offered[0] : null);
  }

  // Duplicate: the same customer (normalized phone) at the same start anywhere in the shop.
  const sameStart = await deps.repo.appointmentsStartingAt(shop.id, iso(startMs));
  if (sameStart.some((a) => a.status !== 'cancelled' && normalizePhone(a.customer_phone) === phoneKey)) {
    return err(409, 'duplicate');
  }

  // Server-side slot rules (hours, breaks, time off, buffer, min notice, lead days) via the
  // slot engine in the shop's timezone; the DB exclusion constraint is the final guard.
  const rules = publicRules(shop);
  const free = await membersFreeAt(deps.repo, shop, r.members, service.duration_min, startMs, nowMs, rules);

  // Per-shop cap across all IPs (so rotating IPs can't flood one calendar), counted only for
  // requests that are about to insert.
  if (free.length > 0 && deps.limits && !(await deps.limits.shopBooking(shop.id))) return shopRateLimited();

  for (const m of free) {
    const price = priceFor(cat, service, m.id);
    const deposit = serviceDeposit(service, price);
    let chargeCents = 0;
    if (pay === 'card') {
      chargeCents = deposit > 0 ? deposit : price ?? 0;
      if (chargeCents < STRIPE_MIN_CENTS) return invalid('pay');
    }
    const row: NewAppointment = {
      shop_id: shop.id,
      member_id: m.id,
      service_id: service.id,
      start_at: iso(startMs),
      end_at: iso(startMs + service.duration_min * MIN),
      service_name: service.name,
      price_cents: price,
      duration_min: service.duration_min,
      customer_name: name,
      customer_phone: phone,
      customer_email: email,
      note: noteText,
      payment_status: pay === 'shop' ? 'none' : 'awaiting',
      payment_method: pay === 'shop' ? 'shop' : pay === 'card' ? 'card' : manualMethod,
      source: 'online',
    };
    const ins = await deps.repo.insertAppointment(row);
    if (ins.ok === false) continue; // 23P01: someone took this barber at this time; try the next free one
    let appt = ins.row;

    // A double-submitted form can race past the duplicate check above and land on two
    // barbers ("any"). After inserting, the copy with the smallest id wins; the others
    // remove themselves. Every racer sees the same winner.
    const twins = (await deps.repo.appointmentsStartingAt(shop.id, iso(startMs)))
      .filter((a) => a.id !== appt.id && a.status !== 'cancelled' && normalizePhone(a.customer_phone) === phoneKey);
    if (twins.some((a) => a.id < appt.id)) {
      await dropHold(deps, appt);
      return err(409, 'duplicate');
    }

    let checkoutUrl: string | undefined;
    if (pay === 'card') {
      try {
        const co = await deps.payments.createCardCheckout(shop, appt, chargeCents);
        checkoutUrl = co.url;
        try {
          const upd = await deps.repo.updateAppointment(appt.id, { stripe_checkout_session_id: co.sessionId });
          if (upd.ok) appt = upd.row;
        } catch (e: any) {
          console.error(`[bookings] storing checkout session for ${appt.id} failed:`, e?.message || e);
        }
      } catch (e: any) {
        // No checkout = no hold: drop the row so the slot is free again.
        console.error(`[bookings] createCardCheckout failed for ${appt.id}:`, e?.message || e);
        try {
          await dropHold(deps, appt);
        } catch (e2: any) {
          console.error(`[bookings] dropping failed card hold ${appt.id} failed:`, e2?.message || e2);
        }
        return err(502, 'payment-unavailable');
      }
    }

    // For an awaiting card hold S2's notify() is a no-op; the webhook confirms on payment.
    await safeNotify(deps, { kind: 'booking_created', appointmentId: appt.id });
    return ok(
      {
        appointment: {
          id: appt.id,
          start: iso(Date.parse(appt.start_at)),
          end: iso(Date.parse(appt.end_at)),
          serviceName: appt.service_name,
          memberName: m.display_name,
          priceCents: appt.price_cents,
          depositCents: deposit,
          // On the shop's own site when it has the pages (lib/customerUrls.ts), else deps.baseUrl.
          manageUrl: manageUrl(customerOrigin(shop, deps.baseUrl), appt.manage_token),
        },
        ...(checkoutUrl ? { checkoutUrl } : {}),
      },
      201,
    );
  }

  const alts = await alternatives(deps.repo, shop, r.members, service.duration_min, startMs, deps.now(), rules);
  return err(409, 'slot-taken', { alternatives: alts });
}

const shopRateLimited = (): FlowResult => ({
  ...err(429, 'rate-limited', { message: 'This shop is getting a lot of bookings right now. Please try again in a few minutes.' }),
  headers: { 'Retry-After': '300' },
});

/**
 * Free the slot of a hold that never became a booking. Hard-deletes only a row that never
 * touched Stripe (no session, no payment intent, nothing paid); anything else is cancelled
 * instead, so a paid booking is never deleted.
 */
async function dropHold(deps: FlowDeps, appt: AppointmentRow): Promise<void> {
  if (await deps.repo.deleteUnpaidAppointment(appt.id)) return;
  await deps.repo.updateAppointment(
    appt.id,
    { status: 'cancelled', cancelled_by: 'customer', cancelled_at: iso(deps.now()) },
    'booked',
  );
}

// ---------------------------------------------------------------------------
// Manage (by token)
// ---------------------------------------------------------------------------
interface ManageCtx {
  appt: AppointmentRow;
  shop: ShopRow;
}

async function byToken(deps: FlowDeps, token: unknown): Promise<ManageCtx | FlowResult> {
  if (!isToken(token)) return notFound();
  const appt = await deps.repo.appointmentByToken(token);
  if (!appt) return notFound();
  const shop = await deps.repo.shopById(appt.shop_id);
  if (!shop) return notFound();
  return { appt, shop };
}
const isResult = (v: ManageCtx | FlowResult): v is FlowResult => 'status' in v;

/**
 * Customer cancel: allowed until the start (spec §10: before the cutoff = full refund,
 * after it = the barber keeps any deposit). An unpaid card hold can always be cancelled.
 * Allowed while bookings are paused (spec §14: existing manage links still allow cancel).
 */
function canCancel(appt: AppointmentRow, nowMs: number): boolean {
  if (appt.status !== 'booked') return false;
  if (isUnpaidCardHold(appt)) return true;
  return nowMs < Date.parse(appt.start_at);
}

/** Customer reschedule: until start - cancel cutoff, and only while bookings are open. */
function canReschedule(shop: ShopRow, appt: AppointmentRow, nowMs: number, open: boolean): boolean {
  if (!open || appt.status !== 'booked') return false;
  return nowMs <= Date.parse(appt.start_at) - Math.max(0, shop.cancel_cutoff_min ?? 0) * MIN;
}

export async function getManage(params: Params, deps: FlowDeps): Promise<FlowResult> {
  const c = await byToken(deps, params.token);
  if (isResult(c)) return c;
  const { appt, shop } = c;
  const nowMs = deps.now();
  const open = await bookingsOpen(deps.repo, shop);
  const name = await memberName(deps.repo, shop.id, appt.member_id);
  return ok({
    appointment: manageView(appt, name, shop),
    canCancel: canCancel(appt, nowMs),
    canReschedule: canReschedule(shop, appt, nowMs, open),
    refundCentsIfCancelled: appt.status === 'booked' ? refundIfCancelled(shop, appt, 'customer', nowMs) : 0,
    ...siteField(shop),
  });
}

export async function postManage(body: unknown, deps: FlowDeps): Promise<FlowResult> {
  if (!isObj(body)) return invalid('body');
  if (body.action !== 'cancel' && body.action !== 'reschedule') return invalid('action');
  const c = await byToken(deps, body.token);
  if (isResult(c)) return c;
  const { appt, shop } = c;
  const nowMs = deps.now();

  if (body.action === 'cancel') {
    if (appt.status === 'cancelled') {
      return ok({ appointment: manageView(appt, await memberName(deps.repo, shop.id, appt.member_id), shop) });
    }
    if (!canCancel(appt, nowMs)) return err(403, 'too-late');
    const out = await cancelAppointment(deps, shop, appt, 'customer');
    if (out.alreadyFinal && out.appt.status !== 'cancelled') return err(403, 'too-late');
    return ok({ appointment: manageView(out.appt, await memberName(deps.repo, shop.id, out.appt.member_id), shop) });
  }

  // reschedule
  const startMs = parseInstant(body.start);
  if (startMs == null) return invalid('start');
  const open = await bookingsOpen(deps.repo, shop);
  if (!open) return paused();
  if (!canReschedule(shop, appt, nowMs, true)) return err(403, 'too-late');
  if (!validZone(shop.timezone)) return paused();

  const cat = await loadCatalog(deps.repo, shop);
  const service = appt.service_id ? cat.services.find((s) => s.id === appt.service_id && s.active) ?? null : null;
  let candidates: MemberRow[] | null;
  const wanted = body.memberId ?? appt.member_id;
  if (service) {
    candidates = candidateMembers(cat, service, wanted);
  } else {
    // Service since deleted: the booking keeps its snapshot; any active member may take it.
    candidates = wanted === 'any' ? cat.members : cat.members.filter((m) => m.id === wanted);
    if (candidates.length === 0) candidates = null;
  }
  if (!candidates) return invalid('memberId');

  // The same customer (phone) may not move onto a start where they already have a booking.
  const phoneKey = normalizePhone(appt.customer_phone);
  if (phoneKey) {
    const sameStart = await deps.repo.appointmentsStartingAt(shop.id, iso(startMs));
    if (sameStart.some((a) => a.id !== appt.id && a.status !== 'cancelled' && normalizePhone(a.customer_phone) === phoneKey)) {
      return err(409, 'duplicate');
    }
  }

  const duration = appt.duration_min;
  const rules = publicRules(shop);
  const free = await membersFreeAt(deps.repo, shop, candidates, duration, startMs, nowMs, rules, appt.id);
  for (const m of free) {
    // Compare-and-set on the start the customer saw: a concurrent owner reschedule wins and
    // this one gets 409 instead of silently overwriting it.
    const upd = await deps.repo.updateAppointment(
      appt.id,
      { start_at: iso(startMs), end_at: iso(startMs + duration * MIN), member_id: m.id, reminder_sent_at: null },
      { status: 'booked', startAt: appt.start_at },
    );
    if (upd.ok === true) {
      await safeNotify(deps, { kind: 'booking_rescheduled', appointmentId: upd.row.id, by: 'customer' });
      return ok({ appointment: manageView(upd.row, m.display_name, shop) });
    }
    if (upd.ok === false && upd.reason === 'stale') {
      const cur = await deps.repo.appointmentById(appt.id);
      if (cur && cur.status === 'booked') return err(409, 'appointment-changed');
      return err(403, 'too-late');
    }
  }
  const alts = await alternatives(deps.repo, shop, candidates, duration, startMs, deps.now(), rules, appt.id);
  return err(409, 'slot-taken', { alternatives: alts });
}

// ---------------------------------------------------------------------------
// POST /api/book/sent  { token, method }
// ---------------------------------------------------------------------------
const SENT_PAYMENT_STATUSES: PaymentStatus[] = ['none', 'awaiting'];

export async function postSent(body: unknown, deps: FlowDeps): Promise<FlowResult> {
  if (!isObj(body)) return invalid('body');
  const method = body.method as ManualMethod;
  if (!MANUAL_METHODS.includes(method)) return invalid('method');
  const c = await byToken(deps, body.token);
  if (isResult(c)) return c;
  const { appt, shop } = c;
  // An existing booking: allowed after a downgrade, refused only on a full lapse (Phase 4).
  if (!(await bookingsFollowUpOpen(deps.repo, shop))) return paused();
  if (!manualHandles(shop)[method]) return invalid('method');
  // Only an online booking on the manual rail chosen at booking time, still unpaid. Never
  // in-shop, card or walk-in bookings, and payment_method is never rewritten here.
  if (
    appt.status !== 'booked'
    || appt.source !== 'online'
    || appt.payment_method !== method
    || !SENT_PAYMENT_STATUSES.includes(appt.payment_status)
  ) {
    return err(409, 'not-awaiting-payment');
  }
  if (appt.customer_says_paid_at) return ok({}); // already told the barber; don't push again

  const upd = await deps.repo.updateAppointment(
    appt.id,
    { customer_says_paid_at: iso(deps.now()) },
    { status: 'booked', method, paymentStatusIn: SENT_PAYMENT_STATUSES },
  );
  if (upd.ok === false) return err(409, 'not-awaiting-payment');
  // The amount the page asked the customer to send (W's manualAmountCents): the deposit when
  // the service has one above 0, else the (member) price. Computed like createAppointment's
  // depositCents; a removed service falls back to the price.
  const service = upd.row.service_id
    ? (await deps.repo.services(shop.id)).find((s) => s.id === upd.row.service_id) ?? null
    : null;
  const deposit = service ? serviceDeposit(service, upd.row.price_cents) : 0;
  const amountCents = deposit > 0 ? deposit : upd.row.price_cents ?? undefined;
  await safeNotify(deps, { kind: 'customer_says_paid', appointmentId: upd.row.id, method, amountCents });
  return ok({});
}

// ---------------------------------------------------------------------------
// GET /api/book/ics?t=<member ics_token>
// ---------------------------------------------------------------------------
export async function getIcs(params: Params, deps: FlowDeps): Promise<FlowResult> {
  if (!isToken(params.t)) return notFound();
  const member = await deps.repo.memberByIcsToken(params.t);
  if (!member) return notFound();
  const shop = await deps.repo.shopById(member.shop_id);
  if (!shop) return notFound();
  const nowMs = deps.now();
  const appts = await deps.repo.memberAppointments(member.id, iso(nowMs - 30 * DAY), iso(nowMs + 180 * DAY));
  return {
    status: 200,
    contentType: 'text/calendar; charset=utf-8',
    body: appointmentsToIcs(
      appts.map((a) => ({
        id: a.id,
        start: iso(Date.parse(a.start_at)),
        end: iso(Date.parse(a.end_at)),
        serviceName: a.service_name,
        customerName: a.customer_name,
        customerPhone: a.customer_phone,
        note: a.note,
        status: a.status,
      })),
      { calendarName: `${member.display_name} · ${shop.name}`, location: shop.address ?? null, now: new Date(nowMs) },
    ),
  };
}
