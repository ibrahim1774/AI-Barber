// Dev-only mocked backend (vite dev server). Never shipped: imported behind import.meta.env.DEV.
import { DateTime } from 'luxon';

const TZ = 'America/New_York';
const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const shop = {
  slug: 'demo', name: 'Demo Cuts', timezone: TZ, address: '123 Main St, Brooklyn, NY', phone: '+1 555 010 2030',
  accent: '#c9a24b', cancelCutoffMin: 120,
  pay: { inShop: true, card: true, manual: { cashapp: '$democuts', venmo: '@democuts', zelle: '555-010-2030', paypal: 'democuts' } },
};
const services = [
  { id: 's1', name: 'Haircut', priceCents: 3000, durationMin: 30, description: 'Classic cut', photoUrl: null, depositCents: 0 },
  { id: 's2', name: 'Cut + Beard', priceCents: 4500, durationMin: 45, description: null, photoUrl: null, depositCents: 1000 },
];
const members = [
  { id: 'm1', name: 'Marcus', photoUrl: null, bio: 'Fades', serviceIds: null },
  { id: 'm2', name: 'Dre', photoUrl: null, bio: null, serviceIds: null },
];

export const mockFetch = async (input: string, init?: RequestInit): Promise<Response> => {
  await new Promise((r) => setTimeout(r, 150));
  const url = new URL(input, 'http://x');
  const p = url.pathname;
  const g = (k: string) => url.searchParams.get(k) || '';
  if (p === '/api/book/shop') return g('slug') === 'demo' ? json(200, { paused: false, shop, services, members })
    : g('slug') === 'paused' ? json(200, { paused: true, shop: { name: 'Closed Cuts' } }) : json(404, { error: 'not-found' });
  if (p === '/api/book/days') {
    const first = DateTime.fromFormat(g('month') + '-01', 'yyyy-MM-dd', { zone: TZ });
    const days: Record<string, boolean> = {};
    for (let d = 0; d < first.daysInMonth!; d++) { const x = first.plus({ days: d }); if (x.weekday !== 1 && x.weekday !== 7) days[x.toFormat('yyyy-MM-dd')] = true; }
    return json(200, { days, timezone: TZ });
  }
  if (p === '/api/book/slots') {
    const day = DateTime.fromFormat(g('date'), 'yyyy-MM-dd', { zone: TZ });
    const slots = [9, 10, 11, 13, 14, 15, 16, 17].map((h, i) => ({ start: day.set({ hour: h }).toUTC().toISO()!, memberId: i % 2 ? 'm2' : 'm1' }));
    return json(200, { slots });
  }
  if (p === '/api/book/appointments') {
    const b = JSON.parse(String(init?.body));
    const svc = services.find((s) => s.id === b.serviceId)!;
    const end = DateTime.fromISO(b.start).plus({ minutes: svc.durationMin }).toUTC().toISO();
    return json(201, {
      appointment: { id: 'a1', start: b.start, end, serviceName: svc.name, memberName: 'Marcus', priceCents: svc.priceCents, depositCents: svc.depositCents, manageUrl: 'http://localhost:3000/book/manage/mocktoken' },
      ...(b.pay === 'card' ? { checkoutUrl: 'https://checkout.stripe.com/mock' } : {}),
    });
  }
  if (p === '/api/book/manage' && (init?.method || 'GET') === 'GET') {
    const start = DateTime.now().setZone(TZ).plus({ days: 3 }).set({ hour: 14, minute: 0, second: 0, millisecond: 0 });
    return json(200, {
      appointment: { id: 'a1', start: start.toUTC().toISO(), end: start.plus({ minutes: 30 }).toUTC().toISO(), status: 'booked', serviceName: 'Haircut', memberName: 'Marcus', priceCents: 3000, amountPaidCents: 3000, paymentStatus: 'paid', shop: { name: shop.name, slug: 'demo', address: shop.address, phone: shop.phone, timezone: TZ } },
      canCancel: true, canReschedule: true, refundCentsIfCancelled: 3000,
    });
  }
  if (p === '/api/book/manage') return json(200, { appointment: {} });
  if (p === '/api/book/sent') return json(200, {});
  return json(404, { error: 'not-found' });
};
