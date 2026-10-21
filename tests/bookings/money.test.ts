import { describe, it, expect } from 'vitest';
import { platformFeeCents, depositCents, refundOnCancel } from '../../lib/bookings/money.js';

describe('platformFeeCents', () => {
  it('2% of common amounts', () => {
    expect(platformFeeCents(3500, 200)).toBe(70);
    expect(platformFeeCents(100, 200)).toBe(2);
  });

  it('rounds half up', () => {
    expect(platformFeeCents(25, 200)).toBe(1); // 0.5 -> 1
    expect(platformFeeCents(24, 200)).toBe(0); // 0.48 -> 0
    expect(platformFeeCents(75, 200)).toBe(2); // 1.5 -> 2
    expect(platformFeeCents(1234, 250)).toBe(31); // 30.85 -> 31
  });

  it('never negative; zero for zero', () => {
    expect(platformFeeCents(-500, 200)).toBe(0);
    expect(platformFeeCents(500, -200)).toBe(0);
    expect(platformFeeCents(0, 200)).toBe(0);
    expect(platformFeeCents(NaN, 200)).toBe(0);
  });
});

describe('depositCents', () => {
  it("'none' is 0", () => {
    expect(depositCents(3500, 'none', 1000)).toBe(0);
  });

  it("'fixed' is min(value, price), or the value when the price is null", () => {
    expect(depositCents(3500, 'fixed', 1000)).toBe(1000);
    expect(depositCents(800, 'fixed', 1000)).toBe(800);
    expect(depositCents(null, 'fixed', 1000)).toBe(1000);
  });

  it("'percent' rounds price * value / 100", () => {
    expect(depositCents(3500, 'percent', 50)).toBe(1750);
    expect(depositCents(3333, 'percent', 25)).toBe(833); // 833.25
    expect(depositCents(3330, 'percent', 25)).toBe(833); // 832.5 rounds up
    expect(depositCents(3500, 'percent', 150)).toBe(3500); // capped at the price
    expect(depositCents(null, 'percent', 50)).toBe(0);
  });

  it('missing or negative values give 0', () => {
    expect(depositCents(3500, 'fixed', null)).toBe(0);
    expect(depositCents(3500, 'percent', -10)).toBe(0);
  });
});

describe('refundOnCancel', () => {
  const startAt = '2026-10-26T15:00:00Z';
  const paid = 1000;
  const at = (now: string, by: 'customer' | 'shop' = 'customer') =>
    refundOnCancel({ by, cutoffMin: 120, startAt, now, amountPaidCents: paid });

  it('customer before the cutoff -> full amount paid', () => {
    expect(at('2026-10-26T12:00:00Z')).toBe(paid);
  });

  it('customer exactly at the cutoff -> full amount (cutoff is inclusive)', () => {
    expect(at('2026-10-26T13:00:00Z')).toBe(paid);
  });

  it('customer after the cutoff -> 0', () => {
    expect(at('2026-10-26T13:00:01Z')).toBe(0);
    expect(at('2026-10-26T16:00:00Z')).toBe(0);
  });

  it('shop at any time -> full amount paid', () => {
    expect(at('2026-10-26T14:59:00Z', 'shop')).toBe(paid);
    expect(at('2026-10-26T18:00:00Z', 'shop')).toBe(paid);
  });

  it('a missing/NaN cutoff counts as 0 (refund until start), not "never"', () => {
    expect(refundOnCancel({ by: 'customer', cutoffMin: NaN, startAt, now: '2026-10-24T12:00:00Z', amountPaidCents: paid })).toBe(paid);
    expect(refundOnCancel({ by: 'customer', cutoffMin: NaN, startAt, now: '2026-10-26T15:00:01Z', amountPaidCents: paid })).toBe(0);
  });

  it('nothing paid -> nothing refunded; accepts Date inputs', () => {
    expect(refundOnCancel({ by: 'shop', cutoffMin: 120, startAt: new Date(startAt), now: new Date(), amountPaidCents: 0 })).toBe(0);
  });
});
