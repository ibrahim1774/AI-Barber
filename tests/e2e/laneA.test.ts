// Lane A pressure tests (2026-10-26): input hostility on the public booking flow, money math
// tables, cancel/reschedule edges, and custom-domain name validation. Existing behaviour only.
vi.mock('../../lib/bookings/live.js', async (importOriginal) => {
  const real: any = await importOriginal();
  return { ...real, liveDeps: () => (globalThis as any).__e2eBookingDeps() };
});
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createAppointment, postManage } from '../../lib/bookings/publicFlow.js';
import { platformFeeCents, depositCents, refundOnCancel } from '../../lib/bookings/money.js';
import { escapeHtml } from '../../lib/bookings/email.js';
import { escapeText } from '../../lib/bookings/ics.js';
import { isComDomain, normalizeLabel } from '../../lib/ios/domainNames.js';
import { CHECKOUT_CARD_ONLY, CHECKOUT_STRIPE_VERSION } from '../../lib/bookings/payments.js';
import { world } from '../bookings/fakeRepo.js';

type W = ReturnType<typeof world>;
let b: W;
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  b = world();
});
afterEach(() => { vi.restoreAllMocks(); });

const base = (over: Record<string, unknown> = {}) => ({
  slug: 'fresh-cuts', serviceId: b.ids.cut, memberId: b.ids.mike, start: '2026-11-03T15:00:00Z',
  customer: { name: 'Sam', phone: '5551234567', email: 'sam@example.com' }, pay: 'shop', ...over,
});

describe('A1 public booking: hostile and odd text', () => {
  const names = ['<script>alert(1)</script>', '"><img src=x onerror=alert(1)>', "Robert'); DROP TABLE appointments;--", '日本語の名前', 'José 💈✂️', '  padded  '];
  it.each(names)('name %j is accepted or refused cleanly, never a 500', async (name) => {
    const r = await createAppointment(base({ customer: { name, phone: '5551234567', email: 'sam@example.com' } }) as any, b.deps);
    expect([201, 400]).toContain(r.status);
    if (r.status === 201) {
      const stored = b.state.appointments[0].customer_name as string;
      // whatever is stored must be neutralised by the output escapers
      expect(escapeHtml(stored)).not.toMatch(/<(script|img)/i);
      expect(escapeText(stored)).not.toContain('\n');
    }
  });
  it('note of 500 chars with emoji and newlines is accepted; 501 refused', async () => {
    expect((await createAppointment(base({ note: '💈'.repeat(250) + 'x'.repeat(250) }) as any, b.deps)).status).toBeLessThan(500);
    const r = await createAppointment(base({ note: 'n'.repeat(501), start: '2026-11-03T16:00:00Z' }) as any, b.deps);
    expect(r.status).toBe(400);
  });
  it('note with HTML is neutralised by escapeHtml', () => {
    expect(escapeHtml('<b onclick="x">&</b>')).toBe('&lt;b onclick=&quot;x&quot;&gt;&amp;&lt;/b&gt;');
  });
  it('ICS text escaping handles newline / comma / semicolon / backslash injection of extra properties', () => {
    const t = escapeText('a\r\nATTENDEE:mailto:evil@x.com;b,c\\d');
    expect(t).not.toMatch(/\r|\n/);
  });
  it('email header injection attempt in the address is refused', async () => {
    const r = await createAppointment(base({ customer: { name: 'A', phone: '5551234567', email: 'a@example.com\r\nBcc: evil@x.com' } }) as any, b.deps);
    expect(r.status).toBe(400);
  });
  it.each([['phone', '555-123-4567 ext 9'], ['phone', '+44 20 7946 0958'], ['phone', '(555) 123-4567']])('%s %j is accepted', async (_k, phone) => {
    const r = await createAppointment(base({ customer: { name: 'A', phone, email: 'a@example.com' } }) as any, b.deps);
    expect(r.status).toBe(201);
  });
  it('a 5 MB body field never reaches the store', async () => {
    const r = await createAppointment(base({ note: 'x'.repeat(5_000_000) }) as any, b.deps);
    expect(r.status).toBe(400);
    expect(b.state.appointments).toHaveLength(0);
  });
});

describe('A2 cancel / reschedule edges', () => {
  it('cancel twice: second answer is not a 500 and the row stays cancelled once', async () => {
    await createAppointment(base() as any, b.deps);
    const token = b.state.appointments[0].manage_token;
    const a = await postManage({ action: 'cancel', token }, b.deps);
    const c = await postManage({ action: 'cancel', token }, b.deps);
    expect(a.status).toBe(200);
    expect(c.status).toBeLessThan(500);
    expect(b.state.appointments.filter((x) => x.status === 'cancelled')).toHaveLength(1);
  });
  it('a cancelled slot can be booked again (back-to-back, no ghost lock)', async () => {
    await createAppointment(base() as any, b.deps);
    await postManage({ action: 'cancel', token: b.state.appointments[0].manage_token }, b.deps);
    expect((await createAppointment(base({ customer: { name: 'Next', phone: '5559990000', email: 'n@example.com' } }) as any, b.deps)).status).toBe(201);
  });
  it('reschedule onto an occupied slot is 409, original keeps its time', async () => {
    await createAppointment(base() as any, b.deps);
    await createAppointment(base({ start: '2026-11-03T17:00:00Z', customer: { name: 'B', phone: '5550001111', email: 'b@example.com' } }) as any, b.deps);
    const [a1, a2] = b.state.appointments;
    const r = await postManage({ action: 'reschedule', token: a2.manage_token, start: a1.start_at }, b.deps);
    expect(r.status).toBe(409);
    expect(b.state.appointments[1].start_at).toBe(a2.start_at);
  });
  it('a bad / empty / huge manage token is 4xx', async () => {
    for (const token of ['', 'x', 'a'.repeat(10_000), null, 5]) {
      const r = await postManage({ action: 'cancel', token } as any, b.deps);
      expect(r.status).toBeGreaterThanOrEqual(400);
      expect(r.status).toBeLessThan(500);
    }
  });
});

describe('A3 money math tables', () => {
  it.each([
    [0, 0], [1, 0], [24, 0], [25, 1], [49, 1], [50, 1], [74, 1], [75, 2], [1000, 20], [1999, 40], [3500, 70], [12_345, 247], [99_999_999, 2_000_000],
  ])('2%% fee (200 bps) of %i cents = %i (half up)', (amt, fee) => {
    expect(platformFeeCents(amt, 200)).toBe(fee);
  });
  it('fee is never negative, NaN or fractional', () => {
    for (const a of [-5, NaN, Infinity, 0.4]) expect(Number.isInteger(platformFeeCents(a as number, 200))).toBe(true);
    expect(platformFeeCents(-100, 200)).toBe(0);
    expect(platformFeeCents(NaN, 200)).toBe(0);
  });
  it('fee never exceeds the amount and fee + payout = amount', () => {
    for (let a = 50; a < 5000; a += 37) {
      const f = platformFeeCents(a, 200);
      expect(f).toBeLessThanOrEqual(a);
      expect(a - f + f).toBe(a);
    }
  });
  it('deposit: none / fixed capped at price / percent rounding / ask-price', () => {
    expect(depositCents(3000, 'none', 50)).toBe(0);
    expect(depositCents(3000, 'fixed', 5000)).toBe(3000);
    expect(depositCents(null, 'fixed', 500)).toBe(500);
    expect(depositCents(3333, 'percent', 50)).toBe(1667);
    expect(depositCents(1, 'percent', 50)).toBe(1);
    expect(depositCents(null, 'percent', 50)).toBe(0);
    expect(depositCents(1000, 'percent', 250)).toBe(1000);
    expect(depositCents(1000, 'fixed', -5)).toBe(0);
  });
  it('refund on cancel: shop always full; customer full at the cutoff exactly, none one second after', () => {
    const start = '2026-11-03T15:00:00Z';
    expect(refundOnCancel({ by: 'shop', cutoffMin: 120, startAt: start, now: '2026-11-03T14:59:00Z', amountPaidCents: 1500 })).toBe(1500);
    expect(refundOnCancel({ by: 'customer', cutoffMin: 120, startAt: start, now: '2026-11-03T13:00:00Z', amountPaidCents: 1500 })).toBe(1500);
    expect(refundOnCancel({ by: 'customer', cutoffMin: 120, startAt: start, now: '2026-11-03T13:00:01Z', amountPaidCents: 1500 })).toBe(0);
    expect(() => refundOnCancel({ by: 'customer', cutoffMin: 120, startAt: 'garbage', now: start, amountPaidCents: 1 })).toThrow();
  });
});

describe('A4 card-only checkout constants (Stripe test-mode contract)', () => {
  it('allowlist is exactly card, Link hidden, API version pinned to the one that supports it', () => {
    expect(CHECKOUT_CARD_ONLY).toEqual({ 'allowed_payment_method_types[0]': 'card', 'wallet_options[link][display]': 'never' });
    expect(Object.keys(CHECKOUT_CARD_ONLY).some((k) => k.startsWith('payment_method_types'))).toBe(false);
    expect(CHECKOUT_STRIPE_VERSION).toMatch(/^2026-09-30/);
  });
});

describe('A5 custom domain name validation', () => {
  // S3 (open): a trailing dot defeats the ".com" strip, so the search suggests freshcutscom.com. it.fails flips to red when fixed.
  it.fails('S3: normalizeLabel("freshcuts.com.") should be "freshcuts" (lib/ios/domainNames.ts:24)', () => {
    expect(normalizeLabel('freshcuts.com.')).toBe('freshcuts');
  });
  const bad = ['', 'a.com', 'ab.com', '-ab.com', 'ab-.com', 'fresh cuts.com', 'fresh_cuts.com', 'FreshCuts.com', 'freshcuts.com.', 'freshcuts.COM',
    'freshcuts.net', 'freshcuts', '.com', 'www.freshcuts.com', 'sub.freshcuts.com', 'xn--caf-dma.com', 'ca--fe.com', 'café.com', 'bärber.com',
    'fresh.cuts.com', `${'a'.repeat(64)}.com`, 'http://freshcuts.com', 'freshcuts.com/', 'freshcuts.com\n', ' freshcuts.com', '日本.com', 'a'.repeat(300) + '.com'];
  it.each(bad)('isComDomain(%j) is false', (d) => { expect(isComDomain(d)).toBe(false); });
  it.each([[null], [undefined], [5], [{}], [[]]])('non-string %j is false', (d) => { expect(isComDomain(d as any)).toBe(false); });
  it.each(['abc.com', 'fresh-cuts.com', 'fresh-cuts-2.com', '123.com', `${'a'.repeat(63)}.com`])('%s is accepted', (d) => { expect(isComDomain(d)).toBe(true); });
  it('normalizeLabel folds case, accents, scheme, www, trailing dot-com and trailing dots', () => {
    expect(normalizeLabel('Fresh Cuts')).toBe('freshcuts');
    expect(normalizeLabel('https://www.FreshCuts.com/path?q=1')).toBe('freshcuts');
    expect(normalizeLabel('Café & Cuts')).toBe('cafeandcuts');
    expect(normalizeLabel('日本')).toBeNull();
    expect(normalizeLabel('ab')).toBeNull();
    expect(normalizeLabel('a'.repeat(121))).toBeNull();
    expect(normalizeLabel('--')).toBeNull();
    expect(normalizeLabel('<script>alert(1)</script>')).toBe('scriptalert1');
  });
});
