import { describe, it, expect } from 'vitest';
import { addTeamMember, httpUrl } from '../../lib/bookings/ownerFlow.js';
import { OTID, world } from './fakeRepo.js';

const AUTH = 'Bearer owner-jwt';
const BOOKINGS = 'com.ibrahim1774.aibarber.bookings.monthly';
const STORE = 'com.ibrahim1774.aibarber.store.yearly';
const HOSTING = 'com.ibrahim1774.aibarber.hosting.monthly';
const add = (w: ReturnType<typeof world>, body: unknown, auth: any = AUTH) => addTeamMember(auth, body, w.deps);
const addNoAuth = (w: ReturnType<typeof world>) => addTeamMember(undefined, { name: 'A' }, w.deps);

describe('POST /api/shop/members: auth', () => {
  it('401 without a token, 404 without a shop', async () => {
    const w = world();
    expect(await addNoAuth(w)).toEqual({ status: 401, body: { error: 'unauthorized' } });
    w.users['stranger'] = { id: '99999999-9999-4999-8999-999999999999', email: null, fullName: null };
    expect(await add(w, { name: 'A' }, 'Bearer stranger')).toEqual({ status: 404, body: { error: 'no-shop' } });
  });

  it('the shop comes only from the caller; a shopId in the body is ignored', async () => {
    const w = world();
    const other = crypto.randomUUID();
    const r = await add(w, { name: 'Sam', shopId: other, shop_id: other, ownerId: other });
    expect(r.status).toBe(200);
    expect(w.state.members.at(-1)!.shop_id).toBe(w.ids.shopId);
  });
});

describe('POST /api/shop/members: limits', () => {
  it('bookings plan: owner + 1 (limit 2), then 409 member-limit {limit: 2}', async () => {
    const w = world();
    w.state.purchases[OTID].product_id = BOOKINGS;
    w.state.members = w.state.members.slice(0, 1); // just the owner
    const r = await add(w, { name: 'Jay' });
    expect(r.status).toBe(200);
    expect(await add(w, { name: 'Tom' })).toEqual({ status: 409, body: { error: 'member-limit', limit: 2 } });
    expect(w.state.members.filter((m) => m.active)).toHaveLength(2);
  });

  it('store plan: 5 people, the sixth is 409 member-limit {limit: 5}', async () => {
    const w = world();
    w.state.purchases[OTID].product_id = STORE;
    for (const n of ['A', 'B', 'C']) expect((await add(w, { name: n })).status).toBe(200); // owner + Jay + 3 = 5
    expect(w.state.members.filter((m) => m.active)).toHaveLength(5);
    expect(await add(w, { name: 'F' })).toEqual({ status: 409, body: { error: 'member-limit', limit: 5 } });
  });

  it('403 members-need-bookings on a hosting-only plan, a null ios_otid, a missing/revoked/taken-down purchase', async () => {
    for (const mutate of [
      (w: ReturnType<typeof world>) => { w.state.purchases[OTID].product_id = HOSTING; },
      (w: ReturnType<typeof world>) => { w.state.shops[0].ios_otid = null; },
      (w: ReturnType<typeof world>) => { delete w.state.purchases[OTID]; },
      (w: ReturnType<typeof world>) => { w.state.purchases[OTID].revoked_at = '2026-10-01T00:00:00Z'; },
      (w: ReturnType<typeof world>) => { w.state.purchases[OTID].taken_down_at = '2026-10-01T00:00:00Z'; },
    ]) {
      const w = world();
      mutate(w);
      const before = w.state.members.length;
      expect(await add(w, { name: 'Sam' })).toEqual({ status: 403, body: { error: 'members-need-bookings' } });
      expect(w.state.members).toHaveLength(before);
    }
  });

  it('downgrade store -> bookings never deactivates existing members; adding is what is gated', async () => {
    const w = world();
    w.state.purchases[OTID].product_id = STORE;
    for (const n of ['A', 'B', 'C']) await add(w, { name: n });
    w.state.purchases[OTID].product_id = BOOKINGS; // 5 active, limit now 2
    expect(await add(w, { name: 'G' })).toEqual({ status: 409, body: { error: 'member-limit', limit: 2 } });
    expect(w.state.members.filter((m) => m.active)).toHaveLength(5);
  });

  it('a lapsed plan blocks adding (403) and leaves members active', async () => {
    const w = world();
    w.state.purchases[OTID].revoked_at = '2026-10-01T00:00:00Z';
    expect((await add(w, { name: 'X' })).status).toBe(403);
    expect(w.state.members.every((m) => m.active)).toBe(true);
  });

  it('two concurrent creates at the limit: exactly one 409 (the repo serialises like the SQL lock)', async () => {
    const w = world();
    w.state.purchases[OTID].product_id = BOOKINGS;
    w.state.members = w.state.members.slice(0, 1);
    const rs = await Promise.all([add(w, { name: 'P' }), add(w, { name: 'Q' })]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
  });

  it('503 members-unavailable until migration 015 is applied', async () => {
    const w = world();
    w.deps.repo.addMember = async () => ({ ok: false, reason: 'unavailable' });
    expect(await add(w, { name: 'Sam' })).toEqual({ status: 503, body: { error: 'members-unavailable' } });
  });
});

describe('POST /api/shop/members: validation and response', () => {
  it('200 returns the member view', async () => {
    const w = world();
    const r = await add(w, { name: ' Sam  ', title: 'Master barber', photo: 'https://cdn.example.com/p.jpg', bio: 'Fades.', bookingUrl: 'https://cal.example.com/sam' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      member: { id: expect.any(String), name: 'Sam', title: 'Master barber', photo: 'https://cdn.example.com/p.jpg', bio: 'Fades.',
        bookingUrl: 'https://cal.example.com/sam', role: 'barber', sort: 2, active: true },
      limit: 5,
    });
  });

  it('optional fields may be absent, null or empty', async () => {
    const w = world();
    const r = await add(w, { name: 'Sam', title: '', photo: null });
    expect(r.status).toBe(200);
    expect((r.body as any).member).toMatchObject({ title: null, photo: null, bio: null, bookingUrl: null });
  });

  it.each([
    ['name missing', {}, 'name'],
    ['name blank', { name: '   ' }, 'name'],
    ['name not text', { name: 5 }, 'name'],
    ['name too long', { name: 'x'.repeat(81) }, 'name'],
    ['title too long', { name: 'A', title: 'x'.repeat(81) }, 'title'],
    ['bio too long', { name: 'A', bio: 'x'.repeat(601) }, 'bio'],
    ['photo javascript:', { name: 'A', photo: 'javascript:alert(1)' }, 'photo'],
    ['photo data:', { name: 'A', photo: 'data:text/html;base64,AAAA' }, 'photo'],
    ['bookingUrl javascript:', { name: 'A', bookingUrl: 'javascript:alert(1)' }, 'bookingUrl'],
    ['bookingUrl JavaScript: mixed case', { name: 'A', bookingUrl: 'JaVaScRiPt:alert(1)' }, 'bookingUrl'],
    ['bookingUrl ftp', { name: 'A', bookingUrl: 'ftp://x.example.com' }, 'bookingUrl'],
    ['bookingUrl relative', { name: 'A', bookingUrl: '/book' }, 'bookingUrl'],
    ['bookingUrl with space/newline', { name: 'A', bookingUrl: 'https://a.example.com/\nx' }, 'bookingUrl'],
    ['bookingUrl too long', { name: 'A', bookingUrl: 'https://a.example.com/' + 'x'.repeat(2048) }, 'bookingUrl'],
    ['bookingUrl not a string', { name: 'A', bookingUrl: 5 }, 'bookingUrl'],
  ])('400 invalid: %s', async (_n, body, field) => {
    const w = world();
    const before = w.state.members.length;
    expect(await add(w, body)).toEqual({ status: 400, body: { error: 'invalid', field } });
    expect(w.state.members).toHaveLength(before);
  });

  it('400 when the body is not an object', async () => {
    const w = world();
    expect(await add(w, 'x')).toEqual({ status: 400, body: { error: 'invalid', field: 'body' } });
    expect(await add(w, null)).toEqual({ status: 400, body: { error: 'invalid', field: 'body' } });
  });
});

describe('httpUrl', () => {
  it('accepts http(s) only', () => {
    expect(httpUrl('https://a.example.com/x?y=1#z', 2048)).toBe('https://a.example.com/x?y=1#z');
    expect(httpUrl(' http://a.example.com ', 2048)).toBe('http://a.example.com');
    expect(httpUrl('', 2048)).toBeNull();
    expect(httpUrl(undefined, 2048)).toBeNull();
    for (const bad of ['javascript:alert(1)', 'https:/x', 'https://', 'mailto:a@b.co', '//evil.com', 'https://a b.com']) expect(httpUrl(bad, 2048)).toBeUndefined();
  });
});
