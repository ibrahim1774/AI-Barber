import { describe, it, expect, vi } from 'vitest';
import { chooseShopSlug, isValidSlug, slugifyName, vercelLabel } from '../../lib/bookings/slug.js';
import { clientIp, makeRateLimiter, memoryStore, READ_LIMIT, WRITE_LIMIT } from '../../lib/bookings/rateLimit.js';
import { authenticate, bearerToken } from '../../lib/bookings/auth.js';
import { appointmentsToIcs } from '../../lib/bookings/ics.stub.js';
import { appointmentIdParam, endpoint } from '../../lib/bookings/http.js';
import { normalizePhone, parseInstant, stripControls, text } from '../../lib/bookings/core.js';

describe('slug', () => {
  it('slugifies and validates', () => {
    expect(slugifyName("Joe's  Fresh Cuts!")).toBe('joes-fresh-cuts');
    expect(isValidSlug('manage')).toBe(false);
    expect(isValidSlug('-x')).toBe(false);
    expect(isValidSlug('fresh-cuts')).toBe(true);
  });
  it('reads the Vercel label only from *.vercel.app', () => {
    expect(vercelLabel('https://fresh-cuts.vercel.app')).toBe('fresh-cuts');
    expect(vercelLabel('https://ios-test-fresh.vercel.app/')).toBe('ios-test-fresh');
    expect(vercelLabel('https://freshcuts.com')).toBeNull();
    expect(vercelLabel('not a url')).toBeNull();
    expect(vercelLabel(null)).toBeNull();
  });
  it('suffixes taken and reserved bases; gives up eventually', async () => {
    const never = async () => false;
    expect(await chooseShopSlug(null, 'Fresh Cuts', never)).toBe('fresh-cuts');
    expect(await chooseShopSlug('label', 'Fresh Cuts', never)).toBe('label');
    expect(await chooseShopSlug(null, 'Shop', never, () => 'ab12')).toBe('shop-ab12');
    expect(await chooseShopSlug(null, '!!!', never)).toBe('barbershop');
    expect(await chooseShopSlug(null, 'Fresh', async (s) => s === 'fresh', () => 'zz99')).toBe('fresh-zz99');
    await expect(chooseShopSlug(null, 'Fresh', async () => true, () => 'zz99')).rejects.toThrow('slug-exhausted');
  });
});

describe('rate limit', () => {
  it('allows 60 reads and 10 writes per minute per IP', () => {
    let now = 0;
    const rl = makeRateLimiter(memoryStore(), () => now);
    for (let i = 0; i < READ_LIMIT; i++) expect(rl.allow('1.1.1.1', 'read')).toBe(true);
    expect(rl.allow('1.1.1.1', 'read')).toBe(false);
    expect(rl.allow('2.2.2.2', 'read')).toBe(true);
    for (let i = 0; i < WRITE_LIMIT; i++) expect(rl.allow('1.1.1.1', 'write')).toBe(true);
    expect(rl.allow('1.1.1.1', 'write')).toBe(false);
    now = 60_000;
    expect(rl.allow('1.1.1.1', 'read')).toBe(true);
    expect(rl.allow('1.1.1.1', 'write')).toBe(true);
  });
  it('client IP from x-real-ip, else first x-forwarded-for hop', () => {
    expect(clientIp({ 'x-real-ip': '9.9.9.9', 'x-forwarded-for': '1.1.1.1' })).toBe('9.9.9.9');
    expect(clientIp({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2' })).toBe('1.1.1.1');
    expect(clientIp({})).toBe('unknown');
  });
});

describe('auth', () => {
  it('parses bearer tokens', () => {
    expect(bearerToken('Bearer abc')).toBe('abc');
    expect(bearerToken(['Bearer abc'])).toBe('abc');
    expect(bearerToken('bearer  abc ')).toBe('abc');
    expect(bearerToken('Basic abc')).toBeNull();
    expect(bearerToken(undefined)).toBeNull();
  });
  it('a throwing getUser is a 401', async () => {
    const r = await authenticate('Bearer x', async () => { throw new Error('boom'); });
    expect(r).toEqual({ ok: false, status: 401, body: { error: 'unauthorized' } });
  });
});

describe('strict instants and control characters', () => {
  it('rejects dates and times that would roll over; wholeMinute rejects seconds', () => {
    expect(parseInstant('2027-02-30T15:00Z')).toBeNull();
    expect(parseInstant('2026-11-31T10:00:00Z')).toBeNull();
    expect(parseInstant('2026-11-03T24:00Z')).toBeNull();
    expect(parseInstant('2026-11-03T23:59:60Z')).toBeNull();
    expect(parseInstant('2026-11-03T10:00+24:00')).toBeNull();
    expect(parseInstant('2028-02-29T10:00:00Z')).toBe(Date.parse('2028-02-29T10:00:00Z'));
    expect(parseInstant('2026-11-03T10:00:00-05:00')).toBe(Date.parse('2026-11-03T15:00:00Z'));
    expect(parseInstant('2026-11-03T15:00:59.999Z')).toBe(Date.parse('2026-11-03T15:00:59.999Z'));
    expect(parseInstant('2026-11-03T15:00:59.999Z', { wholeMinute: true })).toBeNull();
    expect(parseInstant('2026-11-03T15:00:00.000Z', { wholeMinute: true })).toBe(Date.parse('2026-11-03T15:00:00Z'));
    expect(parseInstant('2026-11-03T15:00Z', { wholeMinute: true })).toBe(Date.parse('2026-11-03T15:00:00Z'));
  });

  it('strips control characters; line breaks collapse to a space', () => {
    expect(stripControls('a\u0000b\u007fc\u009fd')).toBe('abcd');
    expect(stripControls('one\r\ntwo\n\nthree\u2028four\tfive')).toBe('one two three four five');
    expect(text('\u0000\u0001', 10)).toBeUndefined();
    expect(text('\n', 10, true)).toBeNull();
    expect(text(' Sam\u0007 ', 10)).toBe('Sam');
  });
});

describe('core validation', () => {
  it('normalizes phones', () => {
    expect(normalizePhone('(555) 123-4567')).toBe('5551234567');
    expect(normalizePhone('+1 555 123 4567')).toBe('5551234567');
    expect(normalizePhone('12')).toBeNull();
    expect(normalizePhone(42)).toBeNull();
  });
  it('requires an explicit offset on instants', () => {
    expect(parseInstant('2026-11-03T15:00:00Z')).toBe(Date.parse('2026-11-03T15:00:00Z'));
    expect(parseInstant('2026-11-03T10:00:00-05:00')).toBe(Date.parse('2026-11-03T15:00:00Z'));
    expect(parseInstant('2026-11-03T15:00:00')).toBeNull();
    expect(parseInstant('2026-11-03')).toBeNull();
    expect(parseInstant(null)).toBeNull();
  });
});

describe('ics feed', () => {
  it('stub feed: escapes, folds at 75 octets and uses CRLF', () => {
    const feed = appointmentsToIcs(
      [{ id: 'a1', start: '2026-11-03T15:00:00.000Z', end: '2026-11-03T15:30:00.000Z', serviceName: 'Cut, fade; ' + 'X'.repeat(150), customerName: 'Sam', status: 'booked' }],
      { calendarName: 'Mike · Fresh', now: new Date(0) },
    );
    expect(feed.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(feed.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(feed).toContain(String.raw`Cut\, fade\; `);
    expect(feed.split('\r\n').every((l) => Buffer.byteLength(l) <= 75)).toBe(true);
  });
});

function res() {
  const r: any = { statusCode: 0, body: undefined, headers: {} as Record<string, string> };
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; return r; };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  r.send = (b: unknown) => { r.body = b; return r; };
  r.end = () => r;
  return r;
}

describe('endpoint wrapper', () => {
  it('OPTIONS, 405, 429, flow passthrough, 500', async () => {
    const run = vi.fn(async () => ({ status: 201, body: { ok: 1 } }));
    let allowed = true;
    const h = endpoint('POST', run, { rate: 'write', limiter: { allow: () => allowed }, tag: 't' });
    let r = res();
    await h({ method: 'OPTIONS' } as any, r);
    expect(r.statusCode).toBe(200);
    expect(r.headers['Access-Control-Allow-Methods']).toBe('OPTIONS,POST');
    r = res();
    await h({ method: 'GET' } as any, r);
    expect(r.statusCode).toBe(405);
    r = res();
    await h({ method: 'POST', headers: {} } as any, r);
    expect(r).toMatchObject({ statusCode: 201, body: { ok: 1 } });
    expect(r.headers['Cache-Control']).toBe('no-store');
    allowed = false;
    r = res();
    await h({ method: 'POST', headers: {} } as any, r);
    expect(r).toMatchObject({ statusCode: 429, body: { error: 'rate-limited' } });
    allowed = true;
    run.mockRejectedValueOnce(new Error('db down'));
    r = res();
    await h({ method: 'POST', headers: {} } as any, r);
    expect(r).toMatchObject({ statusCode: 500, body: { error: 'server-error' } });
  });

  it('sends text/calendar bodies as text', async () => {
    const h = endpoint('GET', async () => ({ status: 200, body: 'BEGIN:VCALENDAR', contentType: 'text/calendar; charset=utf-8' }), { tag: 't' });
    const r = res();
    await h({ method: 'GET', headers: {} } as any, r);
    expect(r.headers['Content-Type']).toBe('text/calendar; charset=utf-8');
    expect(r.body).toBe('BEGIN:VCALENDAR');
  });

  it('appointment id from [id] or the URL', () => {
    expect(appointmentIdParam({ query: { id: 'a' } } as any)).toBe('a');
    expect(appointmentIdParam({ query: {}, url: '/api/shop/appointments/abc-1/cancel' } as any)).toBe('abc-1');
    expect(appointmentIdParam({ query: {}, url: '/api/shop/appointments' } as any)).toBeUndefined();
  });
});
