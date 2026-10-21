import { describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import {
  buildIcs, cashAppLink, formatTime, formatWhen, manualAmountCents, manualLink, monthGrid, nextStep, onAccent,
  parseRoute, parseCheckout, shouldKeepPolling, resolveIds, paypalLink, payOptions, prevStep, progress, safeAccent, shiftMonth, todayKey, tokenFromManageUrl, venmoLink, dateKey, eligibleMembers,
} from '../../src/book/logic';

describe('shop-timezone formatting', () => {
  // 2026-07-10T18:00Z = 2:00 PM New York (EDT), 11:00 AM Los Angeles
  it('formats in the shop tz regardless of the runtime tz', () => {
    expect(formatTime('2026-07-10T18:00:00Z', 'America/New_York')).toBe('2:00 PM');
    expect(formatTime('2026-07-10T18:00:00Z', 'America/Los_Angeles')).toBe('11:00 AM');
    expect(formatWhen('2026-07-10T18:00:00Z', 'America/New_York')).toBe('Fri, Jul 10 at 2:00 PM');
  });
  it('handles winter offset and date rollover', () => {
    expect(formatTime('2026-01-10T18:00:00Z', 'America/New_York')).toBe('1:00 PM');
    expect(dateKey('2026-07-11T02:30:00Z', 'America/New_York')).toBe('2026-07-10');
  });
  it('todayKey uses shop tz', () => {
    const now = DateTime.fromISO('2026-07-11T02:30:00Z');
    expect(todayKey('America/New_York', now)).toBe('2026-07-10');
    expect(todayKey('Asia/Tokyo', now)).toBe('2026-07-11');
  });
});

describe('month grid', () => {
  it('pads to weekday, greys unlisted and past days', () => {
    const g = monthGrid('2026-07', { '2026-07-09': true, '2026-07-10': true, '2026-07-11': true }, '2026-07-10');
    expect(g.filter((c) => c === null).length).toBe(3); // Jul 1 2026 is Wednesday
    const by = (d: number) => g.find((c) => c?.day === d)!;
    expect(by(9)!.enabled).toBe(false);
    expect(by(10)!.enabled).toBe(true);
    expect(by(12)!.enabled).toBe(false);
    expect(g.filter(Boolean).length).toBe(31);
  });
  it('shifts months across years', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
  });
});

describe('deep links', () => {
  it('cash app', () => {
    expect(cashAppLink('$barber', 3000)).toBe('https://cash.app/$barber/30.00');
    expect(cashAppLink('barber', null)).toBe('https://cash.app/$barber');
    expect(cashAppLink('https://cash.app/$barber', 1250)).toBe('https://cash.app/$barber/12.50');
  });
  it('venmo', () => {
    expect(venmoLink('@barber', 3000, 'Cut')).toBe('https://venmo.com/barber?txn=pay&amount=30.00&note=Cut');
    expect(venmoLink('venmo.com/u/barber', null)).toBe('https://venmo.com/barber?txn=pay');
  });
  it('paypal', () => {
    expect(paypalLink('barber', 3000)).toBe('https://paypal.me/barber/30.00USD');
    expect(paypalLink('https://www.paypal.me/barber', null)).toBe('https://paypal.me/barber');
  });
  it('zelle has no link; unknown handle chars are encoded', () => {
    expect(manualLink('zelle', '555-1212', 3000)).toBeNull();
    expect(cashAppLink('a b/evil', 100)).toBe('https://cash.app/$a%20b/1.00');
  });
  it('manual amount prefers deposit', () => {
    expect(manualAmountCents(4500, 1000)).toBe(1000);
    expect(manualAmountCents(4500, 0)).toBe(4500);
    expect(manualAmountCents(null, 0)).toBeNull();
  });
});

describe('step state machine', () => {
  const multi = { barberCount: 2, payOptionCount: 2 };
  const single = { barberCount: 1, payOptionCount: 1 };
  it('walks the full flow', () => {
    const seq = ['service', 'barber', 'day', 'time', 'details', 'payment', 'confirmed'];
    let s: any = 'service';
    for (let i = 1; i < seq.length; i++) { s = nextStep(s, multi); expect(s).toBe(seq[i]); }
  });
  it('skips barber and payment when there is no choice', () => {
    expect(nextStep('service', single)).toBe('day');
    expect(nextStep('details', single)).toBe('confirmed');
    expect(prevStep('day', single)).toBe('service');
    expect(prevStep('day', multi)).toBe('barber');
  });
  it('progress counts only visible steps', () => {
    expect(progress('day', single)).toEqual({ index: 2, total: 4 });
    expect(progress('payment', multi)).toEqual({ index: 6, total: 6 });
  });
  it('eligible members respect serviceIds', () => {
    const ms = [{ id: 'a', serviceIds: null }, { id: 'b', serviceIds: ['s1'] }, { id: 'c', serviceIds: ['s2'] }] as any;
    expect(eligibleMembers(ms, 's1').map((m) => m.id)).toEqual(['a', 'b']);
  });
  it('payOptions defaults to shop', () => {
    expect(payOptions({ inShop: false, card: false, manual: {} })).toEqual(['shop']);
    expect(payOptions({ inShop: true, card: true, manual: { venmo: 'x' } })).toEqual(['shop', 'card', 'manual']);
  });
});

describe('misc', () => {
  it('routes', () => {
    expect(parseRoute('/book/demo')).toEqual({ kind: 'book', slug: 'demo' });
    expect(parseRoute('/book/manage/tok123')).toEqual({ kind: 'manage', token: 'tok123' });
    expect(parseRoute('/book/manage')).toEqual({ kind: 'none' });
    expect(parseRoute('/')).toEqual({ kind: 'none' });
    expect(tokenFromManageUrl('https://www.aibarber.org/book/manage/abc-123?x=1')).toBe('abc-123');
  });
  it('accent safety', () => {
    expect(safeAccent('#abc')).toBe('#aabbcc');
    expect(safeAccent('red;}body{')).toBe('#c9a24b');
    expect(onAccent('#ffffff')).toBe('#111111');
    expect(onAccent('#101010')).toBe('#ffffff');
  });
  it('ics', () => {
    const ics = buildIcs({ id: 'x', start: '2026-07-10T18:00:00Z', end: '2026-07-10T18:30:00Z', summary: 'Cut, fade', location: '1 Main St' });
    expect(ics).toContain('DTSTART:20260710T180000Z');
    expect(ics).toContain('SUMMARY:Cut\\, fade');
    expect(ics).toContain('\r\nEND:VCALENDAR');
  });
});

describe('checkout return and reschedule ids', () => {
  it('parses ?checkout=', () => {
    expect(parseCheckout('?checkout=success')).toBe('success');
    expect(parseCheckout('?checkout=cancelled')).toBe('cancelled');
    expect(parseCheckout('?checkout=x')).toBeNull();
    expect(parseCheckout('')).toBeNull();
  });
  it('polls while awaiting, up to 30 s', () => {
    expect(shouldKeepPolling('awaiting', 0)).toBe(true);
    expect(shouldKeepPolling('awaiting', 29999)).toBe(true);
    expect(shouldKeepPolling('awaiting', 30000)).toBe(false);
    expect(shouldKeepPolling('paid', 0)).toBe(false);
    expect(shouldKeepPolling('deposit', 0)).toBe(false);
  });
  const shop = { services: [{ id: 's9', name: 'Cut' }], members: [{ id: 'm9', name: 'Dre' }] } as any;
  it('uses API ids, falls back to names', () => {
    expect(resolveIds({ serviceId: 's1', memberId: 'm1', serviceName: 'Cut', memberName: 'Dre' }, shop)).toEqual({ serviceId: 's1', memberId: 'm1' });
    expect(resolveIds({ serviceId: null, serviceName: 'Cut', memberName: 'Dre' }, shop)).toEqual({ serviceId: 's9', memberId: 'm9' });
    expect(resolveIds({ serviceId: null, serviceName: 'Nope', memberName: 'Dre' }, shop)).toBeNull();
  });
});

import { bookingErrorMessage, rescheduleErrorMessage, sentErrorMessage, manualMethods } from '../../src/book/logic';
import { mockFetch } from '../../src/book/mock';
import { createApi, ApiError } from '../../src/book/api';

describe('friendly API errors', () => {
  it('rate-limited uses the server message, else the fallback', () => {
    expect(bookingErrorMessage({ status: 429, code: 'rate-limited', serverMessage: 'Slow down, please.' })).toBe('Slow down, please.');
    expect(bookingErrorMessage({ status: 429, code: 'rate-limited' })).toBe('Too many bookings right now. Please try again in a few minutes.');
    expect(bookingErrorMessage({ status: 429, code: 'rate-limited', serverMessage: '  ' })).toBe('Too many bookings right now. Please try again in a few minutes.');
  });
  it('400 on method asks to choose a payment method, with no raw code', () => {
    const m = bookingErrorMessage({ status: 400, code: 'invalid', field: 'method' });
    expect(m).toBe('Please choose how you want to send payment.');
    expect(m).not.toMatch(/invalid|method/);
  });
  it('reschedule 409 variants', () => {
    expect(rescheduleErrorMessage({ status: 409, code: 'duplicate' })).toBe('You already have a booking at that time.');
    expect(rescheduleErrorMessage({ status: 409, code: 'appointment-changed' })).toBe('This booking was just changed. Reload to see the latest.');
    expect(rescheduleErrorMessage({ status: 409, code: 'slot-taken' })).toBe('Sorry, that time was just taken.');
  });
  it('sent not-awaiting-payment', () => {
    expect(sentErrorMessage({ status: 409, code: 'not-awaiting-payment' })).toBe("This booking doesn't need a payment sent.");
    expect(sentErrorMessage({ status: 500, code: 'error' })).toBe("Couldn't record that. Try again.");
    expect(sentErrorMessage(null)).toBe("Couldn't record that. Try again.");
  });
});

describe('mock API with manual method', () => {
  // The mock reads location.search for the checkout flag.
  (globalThis as any).location ??= { search: '' };
  const api = createApi(mockFetch);
  const base = { slug: 'demo', serviceId: 's1', memberId: 'any', start: '2026-12-01T15:00:00Z', customer: { name: 'Sam', phone: '5550102030', email: 's@x.co' } };
  it('books with a method and accepts /sent for the same method only', async () => {
    const r = await api.book({ ...base, pay: 'manual', method: 'venmo' });
    expect(r.appointment.id).toBe('a1');
    await expect(api.sent('t', 'venmo')).resolves.toEqual({});
    await expect(api.sent('t', 'zelle')).rejects.toMatchObject({ status: 409, code: 'not-awaiting-payment' });
  });
  it('rejects a method with the wrong pay type or an unknown handle', async () => {
    await expect(api.book({ ...base, pay: 'shop', method: 'venmo' })).rejects.toMatchObject({ status: 400, field: 'method' });
    await expect(api.book({ ...base, pay: 'manual', method: 'bitcoin' as any })).rejects.toMatchObject({ status: 400, field: 'method' });
  });
  it('returns 429 with a message and surfaces it on ApiError', async () => {
    const e = await api.book({ ...base, customer: { ...base.customer, name: 'ratelimit' }, pay: 'shop' }).catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e.status).toBe(429);
    expect(bookingErrorMessage(e)).toBe(e.serverMessage);
  });
  it('reschedule duplicate / appointment-changed', async () => {
    const at = (h: number) => DateTime.fromISO('2026-12-01', { zone: 'America/New_York' }).set({ hour: h }).toUTC().toISO()!;
    await expect(api.reschedule('t', at(16))).rejects.toMatchObject({ status: 409, code: 'duplicate' });
    await expect(api.reschedule('t', at(17))).rejects.toMatchObject({ status: 409, code: 'appointment-changed' });
    await expect(api.reschedule('t', at(10))).resolves.toBeTruthy();
  });
  it('one payment row per manual method', () => {
    expect(manualMethods({ venmo: '@a', zelle: '1', cashapp: ' ' })).toEqual(['venmo', 'zelle']);
  });
});
