jest.mock('@/lib/supabase', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'tok' } } }) } },
}));
import { getPlan, hostingReadOnlyOpen, planLabel, refreshPlan } from '@/lib/plan';

const PLAN = {
  linked: true, tier: 'bookings', entitlements: { hosting: true, bookings: true, store: false },
  active: true, expiresAt: '2026-11-01T00:00:00Z', takenDownAt: null, revoked: false,
};
const respond = (status: number, body: unknown) =>
  ((global as any).fetch = jest.fn().mockResolvedValue({ status, text: async () => JSON.stringify(body) }));

it('refreshPlan posts { transactionId } with the Bearer token', async () => {
  const f = respond(200, PLAN);
  await expect(refreshPlan('tx-9')).resolves.toEqual(PLAN);
  const [url, init] = f.mock.calls[0];
  expect(url).toMatch(/\/api\/shop\/plan$/);
  expect(init.method).toBe('POST');
  expect(init.headers.Authorization).toBe('Bearer tok');
  expect(JSON.parse(init.body)).toEqual({ transactionId: 'tx-9' });
});

it('getPlan GETs with the Bearer token and no body', async () => {
  const f = respond(200, PLAN);
  await getPlan();
  const [, init] = f.mock.calls[0];
  expect(init.method).toBe('GET');
  expect(init.headers.Authorization).toBe('Bearer tok');
  expect(init.body).toBeUndefined();
});

it('a 404 no-shop rejects with that code', async () => {
  respond(404, { error: 'no-shop' });
  await expect(getPlan()).rejects.toMatchObject({ status: 404, code: 'no-shop' });
});

describe('hostingReadOnlyOpen', () => {
  const now = Date.parse('2026-11-30T00:00:00Z');
  const lapsed = (daysAgo: number) => ({
    entitlements: { hosting: false, bookings: false, store: false },
    expiresAt: new Date(now - daysAgo * 86_400_000).toISOString(),
  });
  it('is true at 29 days and false at 31', () => {
    expect(hostingReadOnlyOpen(lapsed(29), now)).toBe(true);
    expect(hostingReadOnlyOpen(lapsed(31), now)).toBe(false);
  });
  it('is false while hosting is active', () => {
    expect(hostingReadOnlyOpen({ entitlements: PLAN.entitlements, expiresAt: PLAN.expiresAt }, now)).toBe(false);
  });
  it('treats an undated lapse or no plan as recent', () => {
    expect(hostingReadOnlyOpen({ entitlements: { hosting: false, bookings: false, store: false }, expiresAt: null }, now)).toBe(true);
    expect(hostingReadOnlyOpen(null, now)).toBe(true);
  });
});

it('planLabel', () => {
  expect(planLabel('website')).toBe('Website');
  expect(planLabel('bookings')).toBe('Bookings');
  expect(planLabel('store')).toBe('Store');
  expect(planLabel(null)).toBe('None');
});
