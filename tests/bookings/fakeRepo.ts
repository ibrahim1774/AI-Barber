// In-memory BookingRepo for the booking API tests. Emulates the database rules the API relies
// on: the per-member exclusion constraint (23P01 -> 'overlap'), one shop per owner, unique
// slugs / ios_otid, conditional updates (expectStatus) and service-role semantics.
import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import type {
  AppointmentGuard,
  AppointmentRow,
  AvailabilityDbRow,
  BookingRepo,
  MemberRow,
  PurchaseGateRow,
  ServiceMemberRow,
  ServiceRow,
  ShopRow,
  TimeOffRow,
} from '../../lib/bookings/repo.js';
import type { FlowDeps } from '../../lib/bookings/core.js';
import type { OwnerDeps } from '../../lib/bookings/ownerFlow.js';
import type { NotifyEvent } from '../../lib/bookings/deps.js';

export interface State {
  shops: ShopRow[];
  members: MemberRow[];
  services: (ServiceRow & { created?: number })[];
  links: ServiceMemberRow[];
  availability: AvailabilityDbRow[];
  timeOff: TimeOffRow[];
  appointments: AppointmentRow[];
  purchases: Record<string, PurchaseGateRow>;
  sites: Record<string, { user_id: string; deployed_url: string | null }>;
  pushTokens: { user_id: string; expo_token: string; platform: string }[];
  events: { shop_id: string | null; kind: string; payload: Record<string, unknown> }[];
}

const overlaps = (a: AppointmentRow, b: { member_id: string; start_at: string; end_at: string }) =>
  a.member_id === b.member_id && Date.parse(a.start_at) < Date.parse(b.end_at) && Date.parse(b.start_at) < Date.parse(a.end_at);

const tok = () => randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');

export function fakeRepo(state: State, nowFn: () => number = Date.now): BookingRepo {
  const live = (a: AppointmentRow) => a.status !== 'cancelled';
  const conflicts = (row: AppointmentRow) =>
    live(row) && state.appointments.some((o) => o.id !== row.id && live(o) && overlaps(o, row));
  const clone = <T>(v: T): T => (v == null ? v : JSON.parse(JSON.stringify(v)));
  let lastInsertMs = 0;

  return {
    shopBySlug: async (slug) => clone(state.shops.find((s) => s.slug === slug) ?? null),
    shopByOwner: async (id) => clone(state.shops.find((s) => s.owner_id === id) ?? null),
    shopById: async (id) => clone(state.shops.find((s) => s.id === id) ?? null),
    purchase: async (otid) => clone(state.purchases[otid] ?? null),
    services: async (shopId) => clone(state.services.filter((s) => s.shop_id === shopId).sort((a, b) => a.sort - b.sort)),
    members: async (shopId) => clone(state.members.filter((m) => m.shop_id === shopId).sort((a, b) => a.sort - b.sort)),
    serviceMembers: async (ids) => clone(state.links.filter((l) => ids.includes(l.service_id))),
    availability: async (ids) => clone(state.availability.filter((a) => ids.includes(a.member_id))),
    timeOff: async (ids, from, to) =>
      clone(state.timeOff.filter((t) => ids.includes(t.member_id) && Date.parse(t.start_at) < Date.parse(to) && Date.parse(t.end_at) > Date.parse(from))),
    busy: async (ids, from, to) =>
      clone(state.appointments.filter((a) => ids.includes(a.member_id) && live(a)
        && Date.parse(a.start_at) < Date.parse(to) && Date.parse(a.end_at) > Date.parse(from))),
    appointmentsStartingAt: async (shopId, start) =>
      clone(state.appointments.filter((a) => a.shop_id === shopId && live(a) && Date.parse(a.start_at) === Date.parse(start))),
    bookedOverlapping: async (memberId, from, to) =>
      clone(state.appointments.filter((a) => a.status === 'booked' && overlaps(a, { member_id: memberId, start_at: from, end_at: to }))),
    memberAppointments: async (memberId, from, to) =>
      clone(state.appointments.filter((a) => a.member_id === memberId && live(a)
        && Date.parse(a.start_at) >= Date.parse(from) && Date.parse(a.start_at) < Date.parse(to))),

    async insertAppointment(row) {
      // Like Postgres' created_at default: two inserts never share a timestamp, later is later.
      lastInsertMs = Math.max(nowFn(), lastInsertMs + 1);
      const full: AppointmentRow = {
        id: randomUUID(), status: 'booked', cancelled_by: null, cancelled_at: null, reminder_sent_at: null,
        amount_paid_cents: 0, amount_refunded_cents: 0, stripe_payment_intent_id: null, stripe_checkout_session_id: null,
        manage_token: tok(), customer_says_paid_at: null, shop_rescheduled_at: null, refund_due_cents: 0, refund_stuck_at: null,
        created_at: new Date(lastInsertMs).toISOString(), updated_at: new Date(lastInsertMs).toISOString(), ...row,
      };
      const m = state.members.find((x) => x.id === full.member_id);
      if (!m || m.shop_id !== full.shop_id) throw new Error('fk: member not in shop');
      if (!(Date.parse(full.end_at) > Date.parse(full.start_at))) throw new Error('check: time order');
      if (conflicts(full)) return { ok: false, reason: 'overlap' };
      state.appointments.push(full);
      return { ok: true, row: clone(full) };
    },
    async deleteUnpaidAppointment(id) {
      const cur = state.appointments.find((a) => a.id === id);
      if (!cur || cur.stripe_checkout_session_id || cur.stripe_payment_intent_id || cur.amount_paid_cents !== 0) return false;
      state.appointments = state.appointments.filter((a) => a.id !== id);
      return true;
    },
    async updateAppointment(id, patch, expect) {
      const g: AppointmentGuard = typeof expect === 'string' ? { status: expect } : expect ?? {};
      const cur = state.appointments.find((a) => a.id === id);
      const matches = !!cur
        && (!g.status || cur.status === g.status)
        && (!g.startAt || Date.parse(cur.start_at) === Date.parse(g.startAt))
        && (!g.paymentStatusIn || g.paymentStatusIn.includes(cur.payment_status))
        && (!g.notCard || cur.payment_method !== 'card')
        && (!g.method || cur.payment_method === g.method)
        && (g.paidCents == null || cur.amount_paid_cents === g.paidCents)
        && (g.refundedLte == null || cur.amount_refunded_cents <= g.refundedLte)
        && (g.refundDue == null || cur.refund_due_cents === g.refundDue)
        && (!g.notStuck || cur.refund_stuck_at == null)
        && (!g.saysPaidNull || cur.customer_says_paid_at == null);
      if (!cur || !matches) return { ok: false, reason: 'stale' };
      const next = { ...cur, ...patch } as AppointmentRow;
      if (conflicts(next)) return { ok: false, reason: 'overlap' };
      Object.assign(cur, patch, { updated_at: new Date(nowFn()).toISOString() });
      return { ok: true, row: clone(cur) };
    },
    staleCardHolds: async (before, limit) =>
      clone(state.appointments.filter((a) => a.status === 'booked' && a.payment_method === 'card' && a.payment_status === 'awaiting'
        && a.amount_paid_cents === 0 && Date.parse(a.created_at!) < Date.parse(before))
        .sort((a, b) => Date.parse(a.updated_at!) - Date.parse(b.updated_at!)).slice(0, limit)),
    pendingRefunds: async (before, limit) =>
      clone(state.appointments.filter((a) => a.status === 'cancelled' && a.refund_due_cents > a.amount_refunded_cents
        && a.refund_stuck_at == null && a.stripe_payment_intent_id != null && Date.parse(a.updated_at!) < Date.parse(before))
        .sort((a, b) => Date.parse(a.updated_at!) - Date.parse(b.updated_at!)).slice(0, limit)),
    appointmentByToken: async (t) => clone(state.appointments.find((a) => a.manage_token === t) ?? null),
    appointmentById: async (id) => clone(state.appointments.find((a) => a.id === id) ?? null),
    memberByIcsToken: async (t) => clone(state.members.find((m) => m.ics_token === t) ?? null),
    findTimeOff: async (memberId, s, e) =>
      clone(state.timeOff.find((t) => t.member_id === memberId && t.start_at === s && t.end_at === e) ?? null),
    async insertTimeOff(row) {
      const r = { id: randomUUID(), ...row };
      state.timeOff.push(r);
      return clone(r);
    },
    async upsertPushToken(userId, expoToken, platform) {
      const cur = state.pushTokens.find((p) => p.expo_token === expoToken);
      if (cur) Object.assign(cur, { user_id: userId, platform });
      else state.pushTokens.push({ user_id: userId, expo_token: expoToken, platform });
    },
    async logEvent(shopId, kind, payload) {
      state.events.push({ shop_id: shopId, kind, payload });
    },
    slugTaken: async (slug) => state.shops.some((s) => s.slug === slug),
    async insertShop(row) {
      if (state.shops.some((s) => s.owner_id === row.owner_id)) return { ok: false, reason: 'owner-exists' };
      if (state.shops.some((s) => s.slug === row.slug)) return { ok: false, reason: 'slug-taken' };
      const shop = makeShop({ ...row, id: randomUUID() });
      state.shops.push(shop);
      return { ok: true, row: clone(shop) };
    },
    async setShopOtid(shopId, otid) {
      if (state.shops.some((s) => s.ios_otid === otid && s.id !== shopId)) return 'taken';
      state.shops.find((s) => s.id === shopId)!.ios_otid = otid;
      return 'ok';
    },
    async insertMember(row) {
      if (row.role === 'owner' && state.members.some((m) => m.shop_id === row.shop_id && m.role === 'owner')) {
        throw new Error('unique: one owner');
      }
      const m = makeMember({ ...row, id: randomUUID() });
      state.members.push(m);
      return clone(m);
    },
    async insertServices(rows) {
      for (const r of rows) state.services.push(makeService({ ...r, id: randomUUID() }));
    },
    async insertAvailability(rows) {
      for (const r of rows) {
        if (!state.availability.some((a) => a.member_id === r.member_id && a.weekday === r.weekday)) {
          state.availability.push({ break_start_min: null, break_end_min: null, ...r });
        }
      }
    },
    async siteDeployedUrl(siteId, userId) {
      const s = state.sites[siteId];
      if (!s) return null;
      return s.user_id === userId ? { deployedUrl: s.deployed_url } : 'foreign';
    },
  };
}

export function makeShop(p: Partial<ShopRow> & { id: string }): ShopRow {
  return {
    owner_id: randomUUID(), site_id: null, slug: 'fresh-cuts', name: 'Fresh Cuts', timezone: 'America/New_York',
    currency: 'usd', lead_days: 30, min_notice_min: 120, buffer_min: 0, cancel_cutoff_min: 120, slot_step_min: null,
    pay_in_shop: true, manual_handles: {}, stripe_account_id: null, stripe_charges_enabled: false, platform_fee_bps: 200,
    bookings_enabled: true, ios_otid: null, address: null, phone: null, accent: null, daily_summary: false,
    ...p,
  };
}

export function makeMember(p: Partial<MemberRow> & { id: string; shop_id: string }): MemberRow {
  return {
    user_id: null, role: 'barber', display_name: 'Barber', photo_url: null, bio: null, sort: 0, active: true,
    ics_token: tok(), ...p,
  };
}

export function makeService(p: Partial<ServiceRow> & { id: string; shop_id: string }): ServiceRow {
  return {
    name: 'Haircut', price_cents: 3000, duration_min: 30, description: null, photo_url: null, bookable: true,
    show_on_site: true, deposit_type: 'none', deposit_value: null, sort: 0, active: true, ...p,
  };
}

/** Tue–Sat 9:00–18:00 (weekday 0 = Monday). */
export const tueSat = (memberId: string): AvailabilityDbRow[] =>
  [1, 2, 3, 4, 5].map((weekday) => ({ member_id: memberId, weekday, start_min: 540, end_min: 1080, break_start_min: null, break_end_min: null }));

export const OWNER_USER = '11111111-1111-4111-8111-111111111111';
export const OTID = '2000000123456789';

/**
 * A live shop in America/New_York with two barbers (Mike = owner, Jay), one 30-min $30
 * haircut, both working Tue–Sat 9–18, and an active purchase. "Now" is Mon 2026-11-02
 * 07:00 EST (12:00Z), so Tue 2026-11-03 10:00 EST = 15:00Z is bookable.
 */
export function world(over: { shop?: Partial<ShopRow> } = {}) {
  const shopId = randomUUID();
  const mike = randomUUID();
  const jay = randomUUID();
  const cut = randomUUID();
  const state: State = {
    shops: [makeShop({ id: shopId, owner_id: OWNER_USER, ios_otid: OTID, ...over.shop })],
    members: [
      makeMember({ id: mike, shop_id: shopId, role: 'owner', user_id: OWNER_USER, display_name: 'Mike', sort: 0 }),
      makeMember({ id: jay, shop_id: shopId, display_name: 'Jay', sort: 1 }),
    ],
    services: [makeService({ id: cut, shop_id: shopId })],
    links: [],
    availability: [...tueSat(mike), ...tueSat(jay)],
    timeOff: [],
    appointments: [],
    purchases: { [OTID]: { user_id: OWNER_USER, product_id: 'com.ibrahim1774.aibarber.store.monthly', revoked_at: null, taken_down_at: null } },
    sites: {},
    pushTokens: [],
    events: [],
  };
  let nowMs = Date.parse('2026-11-02T12:00:00Z');
  const notified: NotifyEvent[] = [];
  const payments = {
    createCardCheckout: vi.fn(async (_s: ShopRow, a: AppointmentRow, _c: number) => ({ url: `https://checkout.stripe.test/${a.id}`, sessionId: `cs_${a.id}` })),
    refundAppointment: vi.fn(async (_s: ShopRow, _a: AppointmentRow, c: number, _o?: { idempotencyKey?: string }) => ({ refundedCents: c })),
    expireCheckoutSession: vi.fn(async (_s: ShopRow, _id: string) => true),
  };
  const users: Record<string, { id: string; email: string | null; fullName: string | null }> = {
    'owner-jwt': { id: OWNER_USER, email: 'mike@example.com', fullName: 'Mike Fade' },
  };
  const deps: OwnerDeps & FlowDeps = {
    repo: fakeRepo(state, () => nowMs),
    payments,
    notify: vi.fn(async (e: NotifyEvent) => { notified.push(e); }),
    now: () => nowMs,
    baseUrl: 'https://www.aibarber.org',
    getUser: async (jwt) => users[jwt] ?? null,
    purchases: {
      verify: vi.fn(async () => ({ originalTransactionId: OTID })),
      setUser: vi.fn(async (otid: string, userId: string) => { if (state.purchases[otid]) state.purchases[otid].user_id = userId; }),
    },
    rand: (() => { let i = 0; return () => `x${String(i++).padStart(3, '0')}`; })(),
  };
  return {
    state, deps, payments, notified, users,
    ids: { shopId, mike, jay, cut },
    setNow: (iso: string) => { nowMs = Date.parse(iso); },
    shop: () => state.shops[0],
  };
}
