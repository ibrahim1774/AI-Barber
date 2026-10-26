// Owner API flows (Authorization: Bearer <Supabase access token>):
// /api/shop/{setup,appointments,appointments/:id/{cancel,reschedule,mark},time-off,push-token}.
// The caller is verified server-side and the shop is always the one they own; every id in
// a request body is checked to belong to that shop before it is used.
import { authenticate, requireOwner, type AuthUser, type GetUser } from './auth.js';
import {
  alternatives,
  cancelAppointment,
  err,
  invalid,
  isObj,
  isUuid,
  iso,
  memberName,
  notFound,
  ok,
  ownerBookingsAllowed,
  ownerRules,
  ownerView,
  parseInstant,
  paused,
  safeNotify,
  text,
  validZone,
  DAY,
  MIN,
  type FlowDeps,
  type FlowResult,
} from './core.js';
import { entitlementActive } from '../ios/lapse.js';
import { otherAccountBody, type BindingOwner } from '../ios/ownership.js';
import { chooseShopSlug, vercelLabel } from './slug.js';
import type { RateLimiter } from './rateLimit.js';
import type { AppointmentRow, MemberRow, NewAppointment, NewService, PaymentStatus, ShopRow } from './repo.js';

export interface VerifiedPurchase {
  originalTransactionId: string;
}

/** lib/ios verifier + ios_purchases upsert; throws VerifyFailure-like errors with a `code`. */
export interface PurchaseVerifier {
  verify(transactionId: string): Promise<VerifiedPurchase>;
  /** Atomically attach an account-less purchase (ios_purchases.user_id null) to the caller: true = this call linked it, false = already linked. */
  linkUserIfUnlinked(otid: string, userId: string): Promise<boolean>;
}

export interface OwnerDeps extends FlowDeps {
  getUser: GetUser;
  /** Finish this account's unfinished business move; `pending` = still unfinished (do not create a shop yet). */
  finishMove?(userId: string): Promise<{ pending: boolean }>;
  purchases?: PurchaseVerifier;
  /** Per-user write limit on setup's Apple verify (shared with POST /api/shop/plan). Absent = none. */
  writeLimiter?: Pick<RateLimiter, 'allow'>;
  rand?: () => string;
  /** Unlinked purchase: which account owns the shop/site bound to it (id, 'ambiguous', null). */
  bindingOwner?(row: { original_transaction_id: string; site_slug: string | null }): Promise<BindingOwner>;
  /** Masked-hint lookup for a 409 (account id -> email). Absent: hint null. */
  emailOf?(userId: string): Promise<string | null>;
}

type Body = unknown;

/** Default hours seeded for the owner: Tue–Sat 9:00–18:00 (weekday 0 = Monday). */
export const DEFAULT_AVAILABILITY = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start_min: 540, end_min: 1080 }));

const ACCENT_RE = /^#[0-9a-fA-F]{6}$/;

function ownerShopView(shop: ShopRow) {
  return {
    id: shop.id,
    slug: shop.slug,
    name: shop.name,
    timezone: shop.timezone,
    address: shop.address ?? null,
    phone: shop.phone ?? null,
    accent: shop.accent ?? null,
    bookingsEnabled: shop.bookings_enabled,
    payInShop: shop.pay_in_shop,
    manualHandles: shop.manual_handles ?? {},
    stripeChargesEnabled: shop.stripe_charges_enabled,
    purchaseLinked: !!shop.ios_otid,
  };
}

// ---------------------------------------------------------------------------
// POST /api/shop/setup
// ---------------------------------------------------------------------------
interface SetupInput {
  siteId: string;
  name: string;
  timezone: string;
  address: string | null;
  phone: string | null;
  accent: string | null;
  transactionId: string | null;
  services: Omit<NewService, 'shop_id' | 'sort'>[];
}

function parseSetup(body: Body): SetupInput | FlowResult {
  if (!isObj(body)) return invalid('body');
  if (!isUuid(body.siteId)) return invalid('siteId');
  const name = text(body.name, 100);
  if (!name) return invalid('name');
  if (!validZone(body.timezone)) return invalid('timezone');
  const address = text(body.address, 200, true);
  if (address === undefined) return invalid('address');
  const phone = text(body.phone, 40, true);
  if (phone === undefined) return invalid('phone');
  const accent = body.accent == null || body.accent === '' ? null : typeof body.accent === 'string' && ACCENT_RE.test(body.accent) ? body.accent : undefined;
  if (accent === undefined) return invalid('accent');
  const transactionId = body.transactionId == null || body.transactionId === '' ? null
    : typeof body.transactionId === 'string' && /^\d{1,32}$/.test(body.transactionId.trim()) ? body.transactionId.trim() : undefined;
  if (transactionId === undefined) return invalid('transactionId');
  const rawServices = body.services ?? [];
  if (!Array.isArray(rawServices) || rawServices.length > 50) return invalid('services');
  const services: SetupInput['services'] = [];
  for (const s of rawServices) {
    if (!isObj(s)) return invalid('services');
    const sName = text(s.name, 80);
    const price = s.priceCents;
    const dur = s.durationMin;
    const desc = text(s.description, 500, true);
    const photo = text(s.photoUrl, 1000, true);
    if (!sName) return invalid('services');
    if (!(price === null || price === undefined || (Number.isInteger(price) && price >= 0 && price <= 1_000_000))) return invalid('services');
    if (!(Number.isInteger(dur) && dur >= 5 && dur <= 600)) return invalid('services');
    if (desc === undefined || photo === undefined || (photo && !/^https:\/\//i.test(photo))) return invalid('services');
    services.push({ name: sName, price_cents: price ?? null, duration_min: dur, description: desc, photo_url: photo });
  }
  return { siteId: body.siteId, name, timezone: body.timezone as string, address, phone, accent, transactionId, services };
}

const isResult = (v: unknown): v is FlowResult => isObj(v) && typeof (v as any).status === 'number' && 'body' in (v as any);

/**
 * Create (or return) the caller's shop, convergently: a retry after a partial failure
 * fills in whatever is missing (owner member, default hours, services, purchase link).
 * Shops are inserted with the service role only (005 revokes insert from authenticated).
 */
export async function setupShop(authorization: string | string[] | undefined, body: Body, deps: OwnerDeps): Promise<FlowResult> {
  const a = await authenticate(authorization, deps.getUser);
  if (a.ok === false) return { status: a.status, body: a.body };
  const user = a.user;
  const input = parseSetup(body);
  if (isResult(input)) return input;
  const { repo } = deps;

  // Verify the purchase before creating anything.
  let otid: string | null = null;
  if (input.transactionId) {
    if (!deps.purchases) return err(503, 'temporarily-unavailable');
    // Each verify costs App Store Server API calls: the same per-user write limit as /api/shop/plan.
    if (deps.writeLimiter) {
      let allowed = true;
      try {
        allowed = await deps.writeLimiter.allow(user.id, 'write'); // the 'user' scope
      } catch (e: any) {
        console.error('[shop/setup] rate limiter failed, allowing:', e?.message || e); // fail open
      }
      if (!allowed) return { status: 429, body: { error: 'rate-limited' }, headers: { 'Retry-After': '60' } };
    }
    try {
      otid = (await deps.purchases.verify(input.transactionId)).originalTransactionId;
    } catch (e: any) {
      const code = e?.code;
      if (code === 'not-found' || code === 'bad-bundle' || code === 'bad-product') return invalid('transactionId');
      console.error('[shop/setup] purchase verify failed:', e?.message || e);
      return err(503, 'temporarily-unavailable');
    }
    const p = await repo.purchase(otid);
    // A subscription is never movable (DECIDED 2026-10-26): linked to another account = 409, nothing written.
    const refuse = async (ownerId: string | null) => {
      const other = await otherAccountBody(deps.emailOf, ownerId);
      return err(409, 'purchase-other-account', { hint: other.hint });
    };
    if (p?.user_id && p.user_id !== user.id) return refuse(p.user_id);
    if (p && !p.user_id) {
      // Unlinked: whoever owns the shop/site already bound to it is the only account that may claim it
      // (the same Apple ID under a second email must not). Nothing attached yet: first claim wins.
      let owner: BindingOwner = null;
      try {
        owner = deps.bindingOwner ? await deps.bindingOwner({ original_transaction_id: otid, site_slug: p.site_slug }) : null;
      } catch (e: any) {
        console.error('[shop/setup] ownership lookup failed:', e?.message || e);
        return err(503, 'temporarily-unavailable');
      }
      if (owner && owner !== user.id) return refuse(owner === 'ambiguous' ? null : owner);
    }
  }

  // The site row (if any) must be the caller's own.
  const site = await repo.siteDeployedUrl(input.siteId, user.id);
  if (site === 'foreign') return invalid('siteId');

  if (deps.finishMove) {
    // A move that brought a business to this account must land first, or a second (empty) shop would split it.
    const m = await deps.finishMove(user.id).catch(() => ({ pending: true }));
    if (m.pending) return err(503, 'move-in-progress');
  }
  let shop = await repo.shopByOwner(user.id);
  if (!shop) {
    const preferred = vercelLabel(site?.deployedUrl ?? null);
    for (let attempt = 0; attempt < 3 && !shop; attempt++) {
      let slug: string;
      try {
        slug = await chooseShopSlug(preferred, input.name, (s) => repo.slugTaken(s), deps.rand);
      } catch {
        return err(503, 'temporarily-unavailable');
      }
      const ins = await repo.insertShop({
        owner_id: user.id,
        site_id: input.siteId,
        slug,
        name: input.name,
        timezone: input.timezone,
        address: input.address,
        phone: input.phone,
        accent: input.accent,
        // Off until the app's setup wizard finishes (it flips bookings_enabled, 005 grants it).
        bookings_enabled: false,
      });
      if (ins.ok === true) shop = ins.row;
      else if (ins.ok === false && ins.reason === 'owner-exists') shop = await repo.shopByOwner(user.id); // concurrent setup won
      // 'slug-taken': raced on the slug; pick again
    }
    if (!shop) return err(503, 'temporarily-unavailable');
  }

  await ensureOwnerMember(deps, shop, user);
  const services = await repo.services(shop.id);
  if (services.length === 0 && input.services.length > 0) {
    await repo.insertServices(input.services.map((s, i) => ({ ...s, shop_id: shop!.id, sort: i })));
  }

  if (otid) {
    const before = shop.ios_otid;
    if (before !== otid) {
      const r = await repo.setShopOtid(shop.id, otid);
      if (r === 'taken') return err(409, 'purchase-in-use'); // shop link first: nothing is linked to the account then
      shop = { ...shop, ios_otid: otid };
    }
    // Atomic link (UPDATE ... WHERE user_id IS NULL): of two racing accounts exactly one wins. The loser
    // gets the 409 and its shop link is put back, so nothing of the other account's purchase is left behind.
    let lostTo: string | null = null;
    try {
      if (!(await deps.purchases!.linkUserIfUnlinked(otid, user.id))) {
        const again = await repo.purchase(otid);
        if (again?.user_id && again.user_id !== user.id) lostTo = again.user_id;
      }
    } catch (e: any) {
      console.error('[shop/setup] linking purchase to account failed:', e?.message || e); // best effort
    }
    if (lostTo) {
      if (before !== otid) await repo.setShopOtid(shop.id, before).catch((e: any) => console.error('[shop/setup] shop link revert failed:', e?.message || e));
      const other = await otherAccountBody(deps.emailOf, lostTo);
      return err(409, 'purchase-other-account', { hint: other.hint });
    }
  }
  return ok({ shop: ownerShopView(shop) });
}

async function ensureOwnerMember(deps: OwnerDeps, shop: ShopRow, user: AuthUser): Promise<MemberRow> {
  const { repo } = deps;
  const existing = (await repo.members(shop.id)).find((m) => m.role === 'owner') ?? null;
  if (existing) return existing;
  // Default hours only for an owner member created in THIS call. An existing owner with no
  // availability rows closed every day on purpose; a later setup re-POST (purchase re-link,
  // services: []) must not hand them default hours back.
  let owner: MemberRow;
  try {
    owner = await repo.insertMember({
      shop_id: shop.id,
      user_id: user.id,
      role: 'owner',
      display_name: user.fullName?.trim().slice(0, 100) || 'Owner',
      sort: 0,
    });
  } catch (e) {
    const won = (await repo.members(shop.id)).find((m) => m.role === 'owner') ?? null; // concurrent insert won
    if (!won) throw e;
    return won; // the call that created it seeds the hours
  }
  await repo.insertAvailability(DEFAULT_AVAILABILITY.map((d) => ({ member_id: owner.id, ...d })));
  return owner;
}

// ---------------------------------------------------------------------------
// POST /api/shop/appointments (walk-in / owner booking)
// ---------------------------------------------------------------------------
export async function createOwnerAppointment(authorization: string | string[] | undefined, body: Body, deps: OwnerDeps): Promise<FlowResult> {
  const o = await requireOwner(authorization, deps.getUser, deps.repo);
  if (o.ok === false) return { status: o.status, body: o.body };
  const { shop } = o;
  // Phase 4: creating or moving bookings needs a live plan with bookings (cancel and mark never do).
  if (!(await ownerBookingsAllowed(deps.repo, shop))) return paused();
  if (!isObj(body)) return invalid('body');
  const startMs = parseInstant(body.start, { wholeMinute: true });
  if (startMs == null) return invalid('start');
  if (!isObj(body.customer)) return invalid('customer');
  const name = text(body.customer.name, 100);
  if (!name) return invalid('customer.name');
  const phone = text(body.customer.phone, 40, true);
  if (phone === undefined) return invalid('customer.phone');
  const email = text(body.customer.email, 254, true);
  if (email === undefined || (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) return invalid('customer.email');
  const note = text(body.note, 500, true);
  if (note === undefined) return invalid('note');

  const [members, services] = await Promise.all([deps.repo.members(shop.id), deps.repo.services(shop.id)]);
  const member = isUuid(body.memberId) ? members.find((m) => m.id === body.memberId && m.active && m.shop_id === shop.id) : undefined;
  if (!member) return invalid('memberId');
  const service = isUuid(body.serviceId) ? services.find((s) => s.id === body.serviceId && s.active && s.shop_id === shop.id) : undefined;
  if (!service) return invalid('serviceId');

  // Owner bookings skip minimum notice and lead days; only the exclusion constraint applies.
  const row: NewAppointment = {
    shop_id: shop.id,
    member_id: member.id,
    service_id: service.id,
    start_at: iso(startMs),
    end_at: iso(startMs + service.duration_min * MIN),
    service_name: service.name,
    price_cents: service.price_cents,
    duration_min: service.duration_min,
    customer_name: name,
    customer_phone: phone,
    customer_email: email,
    note,
    payment_status: 'none',
    payment_method: null,
    source: 'walk_in',
  };
  const ins = await deps.repo.insertAppointment(row);
  if (ins.ok === false) return slotTaken(deps, shop, member, service.duration_min, startMs);
  return ok({ appointment: ownerView(ins.row, member.display_name) }, 201);
}

async function slotTaken(deps: OwnerDeps, shop: ShopRow, member: MemberRow, durationMin: number, startMs: number, excludeId?: string) {
  let alts: Awaited<ReturnType<typeof alternatives>> = [];
  if (validZone(shop.timezone)) {
    alts = await alternatives(deps.repo, shop, [member], durationMin, startMs, deps.now(), ownerRules, excludeId);
  }
  return err(409, 'slot-taken', { alternatives: alts });
}

async function ownedAppointment(deps: OwnerDeps, shop: ShopRow, id: unknown) {
  if (!isUuid(id)) return null;
  const appt = await deps.repo.appointmentById(id);
  return appt && appt.shop_id === shop.id ? appt : null;
}

// ---------------------------------------------------------------------------
// POST /api/shop/appointments/:id/cancel
// ---------------------------------------------------------------------------
export async function cancelOwnerAppointment(authorization: string | string[] | undefined, id: unknown, deps: OwnerDeps): Promise<FlowResult> {
  const o = await requireOwner(authorization, deps.getUser, deps.repo);
  if (o.ok === false) return { status: o.status, body: o.body };
  const { shop } = o;
  const appt = await ownedAppointment(deps, shop, id);
  if (!appt) return notFound();
  if (appt.status === 'cancelled') return ok({ appointment: ownerView(appt, await memberName(deps.repo, shop.id, appt.member_id)) });
  if (appt.status !== 'booked') return err(409, 'not-cancellable');
  const out = await cancelAppointment(deps, shop, appt, 'shop');
  if (out.alreadyFinal && out.appt.status !== 'cancelled') return err(409, 'not-cancellable');
  return ok({ appointment: ownerView(out.appt, await memberName(deps.repo, shop.id, out.appt.member_id)) });
}

// ---------------------------------------------------------------------------
// POST /api/shop/appointments/:id/reschedule  { start, memberId? }
// ---------------------------------------------------------------------------
export async function rescheduleOwnerAppointment(
  authorization: string | string[] | undefined,
  id: unknown,
  body: Body,
  deps: OwnerDeps,
): Promise<FlowResult> {
  const o = await requireOwner(authorization, deps.getUser, deps.repo);
  if (o.ok === false) return { status: o.status, body: o.body };
  const { shop } = o;
  // Phase 4: creating or moving bookings needs a live plan with bookings (cancel and mark never do).
  if (!(await ownerBookingsAllowed(deps.repo, shop))) return paused();
  if (!isObj(body)) return invalid('body');
  const startMs = parseInstant(body.start, { wholeMinute: true });
  if (startMs == null) return invalid('start');
  const appt = await ownedAppointment(deps, shop, id);
  if (!appt) return notFound();
  if (appt.status !== 'booked') return err(409, 'not-reschedulable');
  const members = await deps.repo.members(shop.id);
  const targetId = body.memberId == null ? appt.member_id : body.memberId;
  const member = isUuid(targetId) ? members.find((m) => m.id === targetId && m.active && m.shop_id === shop.id) : undefined;
  if (!member) return invalid('memberId');

  // Owner reschedules, like owner bookings, skip notice/lead days; the DB guard still applies.
  // shop_rescheduled_at: if the customer then cancels, they get a full refund (core.refundIfCancelled).
  // reminder_sent_at: null so S2's reminders cron reminds about the new time.
  const upd = await deps.repo.updateAppointment(
    appt.id,
    {
      start_at: iso(startMs),
      end_at: iso(startMs + appt.duration_min * MIN),
      member_id: member.id,
      reminder_sent_at: null,
      shop_rescheduled_at: iso(deps.now()),
    },
    'booked',
  );
  if (upd.ok === false) {
    if (upd.reason === 'stale') return err(409, 'not-reschedulable');
    return slotTaken(deps, shop, member, appt.duration_min, startMs, appt.id);
  }
  await safeNotify(deps, { kind: 'booking_rescheduled', appointmentId: upd.row.id, by: 'shop' });
  return ok({ appointment: ownerView(upd.row, member.display_name) });
}

// ---------------------------------------------------------------------------
// POST /api/shop/appointments/:id/mark  { action: 'paid' | 'done' | 'no_show' }
// ---------------------------------------------------------------------------
// Owners can't UPDATE ab_appointments directly (006 revokes it), so money columns only move
// here, in the cancel path, or from Stripe's webhook. Card money is Stripe's alone.
const MARK_PAID_FROM: PaymentStatus[] = ['none', 'awaiting', 'deposit'];

export async function markOwnerAppointment(
  authorization: string | string[] | undefined,
  id: unknown,
  body: Body,
  deps: OwnerDeps,
): Promise<FlowResult> {
  const o = await requireOwner(authorization, deps.getUser, deps.repo);
  if (o.ok === false) return { status: o.status, body: o.body };
  const { shop } = o;
  if (!isObj(body)) return invalid('body');
  const action = body.action;
  if (action !== 'paid' && action !== 'done' && action !== 'no_show') return invalid('action');
  const appt = await ownedAppointment(deps, shop, id);
  if (!appt) return notFound();
  const view = async (row: AppointmentRow) => ok({ appointment: ownerView(row, await memberName(deps.repo, shop.id, row.member_id)) });

  if (action === 'done' || action === 'no_show') {
    if (appt.status === action) return view(appt); // a repeated tap changes nothing
    if (appt.status !== 'booked') return err(409, 'not-markable');
    const upd = await deps.repo.updateAppointment(appt.id, { status: action }, 'booked');
    if (upd.ok === true) return view(upd.row);
    const cur = await deps.repo.appointmentById(appt.id);
    return cur?.status === action ? view(cur) : err(409, 'not-markable');
  }

  // paid
  if (appt.payment_method === 'card') return err(409, 'card-payment');
  if (appt.payment_status === 'paid') return view(appt); // a repeated tap changes nothing
  if (!MARK_PAID_FROM.includes(appt.payment_status)) return err(409, 'not-markable');
  const upd = await deps.repo.updateAppointment(
    appt.id,
    {
      payment_status: 'paid',
      amount_paid_cents: Math.max(appt.price_cents ?? 0, appt.amount_paid_cents),
      payment_method: appt.payment_method ?? 'shop',
    },
    // Compare-and-set on what was read, so a concurrent webhook or mark is never overwritten.
    { notCard: true, paymentStatusIn: MARK_PAID_FROM, paidCents: appt.amount_paid_cents },
  );
  if (upd.ok === true) return view(upd.row);
  const cur = await deps.repo.appointmentById(appt.id);
  if (cur?.payment_method === 'card') return err(409, 'card-payment');
  return cur?.payment_status === 'paid' ? view(cur) : err(409, 'not-markable');
}

// ---------------------------------------------------------------------------
// POST /api/shop/time-off  { memberId, start, end, reason?, cancelConflicts }
// ---------------------------------------------------------------------------
export async function createTimeOff(authorization: string | string[] | undefined, body: Body, deps: OwnerDeps): Promise<FlowResult> {
  const o = await requireOwner(authorization, deps.getUser, deps.repo);
  if (o.ok === false) return { status: o.status, body: o.body };
  const { shop } = o;
  // Phase 4: creating or moving bookings needs a live plan with bookings (cancel and mark never do).
  if (!(await ownerBookingsAllowed(deps.repo, shop))) return paused();
  if (!isObj(body)) return invalid('body');
  const startMs = parseInstant(body.start, { wholeMinute: true });
  if (startMs == null) return invalid('start');
  const endMs = parseInstant(body.end, { wholeMinute: true });
  if (endMs == null || endMs <= startMs || endMs - startMs > 366 * DAY) return invalid('end');
  const reason = text(body.reason, 200, true);
  if (reason === undefined) return invalid('reason');
  if (body.cancelConflicts != null && typeof body.cancelConflicts !== 'boolean') return invalid('cancelConflicts');
  const cancelConflicts = body.cancelConflicts === true;
  const members = await deps.repo.members(shop.id);
  const member = isUuid(body.memberId) ? members.find((m) => m.id === body.memberId && m.shop_id === shop.id) : undefined;
  if (!member) return invalid('memberId');

  // Same block sent twice (ask first, then "cancel them") is stored once.
  const s = iso(startMs);
  const e = iso(endMs);
  if (!(await deps.repo.findTimeOff(member.id, s, e))) {
    await deps.repo.insertTimeOff({ member_id: member.id, start_at: s, end_at: e, reason });
  }

  const overlapping = await deps.repo.bookedOverlapping(member.id, s, e);
  const conflicts = overlapping.map((a) => ({ id: a.id, start: iso(Date.parse(a.start_at)), customerName: a.customer_name ?? '' }));
  if (cancelConflicts) {
    for (const a of overlapping) await cancelAppointment(deps, shop, a, 'shop');
  }
  return ok({ conflicts });
}

// ---------------------------------------------------------------------------
// POST /api/shop/push-token  { expoToken, platform: 'ios' }
// ---------------------------------------------------------------------------
const EXPO_TOKEN_RE = /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$/;

export async function registerPushToken(authorization: string | string[] | undefined, body: Body, deps: OwnerDeps): Promise<FlowResult> {
  const a = await authenticate(authorization, deps.getUser);
  if (a.ok === false) return { status: a.status, body: a.body };
  if (!isObj(body)) return invalid('body');
  if (typeof body.expoToken !== 'string' || !EXPO_TOKEN_RE.test(body.expoToken)) return invalid('expoToken');
  if (body.platform !== 'ios') return invalid('platform');
  await deps.repo.upsertPushToken(a.user.id, body.expoToken, 'ios');
  return ok({});
}

// ---------------------------------------------------------------------------
// POST /api/shop/members  { name, title?, photo?, bio?, bookingUrl? }
// Adds a barber. The only add path once migration 016 revokes direct INSERT: the cap is
// enforced in the database (ab_add_member locks the shop row and counts active members).
// Limit by plan: Store 5, Bookings 2 (owner included), else 403 members-need-bookings (also
// with no linked purchase). The shop id comes only from requireOwner. Limits gate adding
// only: nothing here (or anywhere) deactivates an existing member.
// ---------------------------------------------------------------------------
export const MEMBER_LIMITS = { store: 5, bookings: 2 } as const;

/**
 * An absolute http(s) URL of at most `max` chars, trimmed (null when absent/empty). undefined
 * when invalid: not a string, a non-http(s) scheme (javascript:, data:, ...), relative,
 * protocol-relative, no host, or containing whitespace/control characters.
 */
export function httpUrl(v: unknown, max: number): string | null | undefined {
  if (v == null || v === '') return null;
  if (typeof v !== 'string') return undefined;
  const t = v.trim();
  if (!t) return null;
  if (t.length > max || /[\u0000-\u0020\u007F-\u009F]/.test(t)) return undefined;
  if (!/^https?:\/\/[^/?#]+/i.test(t)) return undefined;
  try {
    const u = new URL(t);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname ? t : undefined;
  } catch {
    return undefined;
  }
}

export async function addTeamMember(authorization: string | string[] | undefined, body: Body, deps: OwnerDeps): Promise<FlowResult> {
  const o = await requireOwner(authorization, deps.getUser, deps.repo);
  if (o.ok === false) return { status: o.status, body: o.body };
  const { shop, user } = o;
  // Same gate as the bookings flows: the linked purchase is live and its product grants the tier.
  const purchase = shop.ios_otid ? await deps.repo.purchase(shop.ios_otid) : null;
  const limit = entitlementActive(purchase, 'store') ? MEMBER_LIMITS.store : entitlementActive(purchase, 'bookings') ? MEMBER_LIMITS.bookings : 0;
  if (!limit) return err(403, 'members-need-bookings');

  if (!isObj(body)) return invalid('body');
  const name = text(body.name, 80);
  if (!name) return invalid('name');
  const title = text(body.title, 80, true);
  if (title === undefined) return invalid('title');
  const bio = text(body.bio, 600, true);
  if (bio === undefined) return invalid('bio');
  const photo = httpUrl(body.photo, 2048);
  if (photo === undefined) return invalid('photo');
  const bookingUrl = httpUrl(body.bookingUrl, 2048);
  if (bookingUrl === undefined) return invalid('bookingUrl');

  const r = await deps.repo.addMember({
    shop_id: shop.id, owner_id: user.id, limit,
    display_name: name, title, photo_url: photo, bio, booking_url: bookingUrl,
  });
  if (r.ok === false) {
    if (r.reason === 'member-limit') return err(409, 'member-limit', { limit });
    if (r.reason === 'unavailable') return err(503, 'members-unavailable');
    if (r.reason === 'invalid') return invalid('member');
    return err(404, 'no-shop'); // not-owner: cannot happen with a shop from requireOwner
  }
  const m = r.row;
  return ok({
    member: {
      id: m.id, name: m.display_name, title: m.title, photo: m.photo_url, bio: m.bio,
      bookingUrl: m.booking_url, role: m.role, sort: m.sort, active: m.active,
    },
    limit,
  });
}
