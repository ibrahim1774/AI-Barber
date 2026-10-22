import { describe, it, expect, vi } from 'vitest';
import { makeVercelDomains, registrantContact, type Fetch } from '../../lib/ios/vercelDomains.js';

type Reply = { status: number; body?: any };

function fakeFetch(replies: Reply[] | ((url: string, init: any) => Reply)) {
  const calls: { url: string; method: string; body: any; auth: string }[] = [];
  const f = vi.fn<Fetch>(async (url, init) => {
    calls.push({ url, method: init?.method || 'GET', body: init?.body ? JSON.parse(init.body) : undefined, auth: init?.headers?.Authorization || '' });
    const r = typeof replies === 'function' ? replies(url, init) : replies.shift()!;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body ?? {} };
  });
  return { f, calls };
}

const CONTACT = {
  firstName: 'A', lastName: 'B', email: 'ops@example.com', phone: '+15555550100',
  address1: '1 Main St', city: 'Town', state: 'CA', zip: '90000', country: 'US',
};

describe('makeVercelDomains: exact endpoints and bodies', () => {
  it('bulk availability and price', async () => {
    const { f, calls } = fakeFetch([
      { status: 200, body: { results: [{ domain: 'a.com', available: true }, { domain: 'b.com', available: false }] } },
      { status: 200, body: { results: [{ domain: 'a.com', years: 1, purchasePrice: 11.25, renewalPrice: 11.25, transferPrice: 11.25 }] } },
    ]);
    const v = makeVercelDomains({ token: 'tok', fetch: f });
    expect([...(await v.availability(['a.com', 'b.com']))]).toEqual([['a.com', true], ['b.com', false]]);
    expect((await v.prices(['a.com'])).get('a.com')).toEqual({ purchasePrice: 11.25, renewalPrice: 11.25 });
    expect(calls[0]).toMatchObject({ url: 'https://api.vercel.com/v1/registrar/domains/availability', method: 'POST', body: { domains: ['a.com', 'b.com'] }, auth: 'Bearer tok' });
    expect(calls[1]).toMatchObject({ url: 'https://api.vercel.com/v1/registrar/domains/price', method: 'POST', body: { domains: ['a.com'], years: 1 } });
  });

  it('chunks bulk calls at 50 names', async () => {
    const { f, calls } = fakeFetch(() => ({ status: 200, body: { results: [] } }));
    await makeVercelDomains({ token: 't', fetch: f }).availability(Array.from({ length: 120 }, (_, i) => `d${i}x.com`));
    expect(calls.map((c) => c.body.domains.length)).toEqual([50, 50, 20]);
  });

  it('teamId only when configured, on every call', async () => {
    const { f, calls } = fakeFetch(() => ({ status: 200, body: { results: [] } }));
    await makeVercelDomains({ token: 't', teamId: 'team_x', fetch: f }).availability(['a.com']);
    expect(calls[0].url).toBe('https://api.vercel.com/v1/registrar/domains/availability?teamId=team_x');
  });

  it('buy: autoRenew, years 1, expectedPrice, contactInformation', async () => {
    const { f, calls } = fakeFetch([{ status: 200, body: { orderId: 'ord_1', _links: {} } }]);
    const r = await makeVercelDomains({ token: 't', fetch: f }).buy('fresh.com', { expectedPrice: 11.25, autoRenew: true, contact: CONTACT });
    expect(r).toEqual({ ok: true, orderId: 'ord_1' });
    expect(calls[0]).toMatchObject({
      url: 'https://api.vercel.com/v1/registrar/domains/fresh.com/buy', method: 'POST',
      body: { autoRenew: true, years: 1, expectedPrice: 11.25, contactInformation: CONTACT },
    });
  });

  it.each([
    [{ status: 400, body: { code: 'domain_not_available' } }, { ok: false, code: 'domain_not_available', status: 400, definite: true }],
    [{ status: 400, body: { code: 'expected_price_mismatch' } }, { ok: false, code: 'expected_price_mismatch', status: 400, definite: true }],
    [{ status: 500, body: { code: 'internal_server_error' } }, { ok: false, code: 'internal_server_error', status: 500, definite: false }],
    [{ status: 429, body: { code: 'too_many_requests' } }, { ok: false, code: 'too_many_requests', status: 429, definite: false }],
  ])('buy failure %j', async (reply, out) => {
    const { f } = fakeFetch([reply]);
    expect(await makeVercelDomains({ token: 't', fetch: f }).buy('x.com', { expectedPrice: 1, autoRenew: true, contact: CONTACT })).toEqual(out);
  });

  it('buy: a network error is an UNKNOWN outcome (not definite)', async () => {
    const f = vi.fn<Fetch>(async () => { throw new Error('socket hang up'); });
    expect(await makeVercelDomains({ token: 't', fetch: f }).buy('x.com', { expectedPrice: 1, autoRenew: true, contact: CONTACT }))
      .toEqual({ ok: false, code: 'network', status: 0, definite: false });
  });

  it('order status, owned domain, auto-renew', async () => {
    const { f, calls } = fakeFetch([
      { status: 200, body: { orderId: 'o', status: 'completed', domains: [{ domainName: 'x.com', status: 'completed' }] } },
      { status: 200, body: { domain: { boughtAt: 1, expiresAt: 4_000_000_000_000, renew: true } } },
      { status: 404, body: { error: { code: 'not_found' } } },
      { status: 204 },
    ]);
    const v = makeVercelDomains({ token: 't', fetch: f });
    expect(await v.order('o', 'x.com')).toEqual({ status: 'completed', domainStatus: 'completed', errorCode: null });
    expect(await v.owned('x.com')).toEqual({ boughtAt: 1, expiresAt: 4_000_000_000_000, renew: true });
    expect(await v.owned('y.com')).toBeNull();
    await v.setAutoRenew('x.com', false);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET https://api.vercel.com/v1/registrar/orders/o',
      'GET https://api.vercel.com/v5/domains/x.com',
      'GET https://api.vercel.com/v5/domains/y.com',
      'PATCH https://api.vercel.com/v1/registrar/domains/x.com/auto-renew',
    ]);
    expect(calls[3].body).toEqual({ autoRenew: false });
  });

  it('project domains: www redirects (308) to the apex; already-on-this-project is fine', async () => {
    const { f, calls } = fakeFetch([
      { status: 200, body: { name: 'x.com' } },
      { status: 409, body: { error: { code: 'domain_already_in_use' } } },
      { status: 200, body: { name: 'www.x.com', verified: true, redirect: 'x.com' } },
    ]);
    const v = makeVercelDomains({ token: 't', fetch: f });
    expect(await v.addProjectDomain('fresh-cuts', 'x.com')).toBe('added');
    expect(await v.addProjectDomain('fresh-cuts', 'www.x.com', 'x.com')).toBe('exists');
    expect(calls[0]).toMatchObject({ url: 'https://api.vercel.com/v10/projects/fresh-cuts/domains', method: 'POST', body: { name: 'x.com' } });
    expect(calls[1].body).toEqual({ name: 'www.x.com', redirect: 'x.com', redirectStatusCode: 308 });
    expect(calls[2]).toMatchObject({ url: 'https://api.vercel.com/v9/projects/fresh-cuts/domains/www.x.com', method: 'GET' });
  });

  it('a domain held by ANOTHER project is an error, not "exists"', async () => {
    const { f } = fakeFetch([{ status: 409, body: { error: { code: 'domain_already_in_use' } } }, { status: 404 }]);
    await expect(makeVercelDomains({ token: 't', fetch: f }).addProjectDomain('p', 'x.com')).rejects.toMatchObject({ status: 409 });
  });

  it('remove: 404 is already absent', async () => {
    const { f, calls } = fakeFetch([{ status: 200 }, { status: 404 }]);
    const v = makeVercelDomains({ token: 't', fetch: f });
    expect(await v.removeProjectDomain('p', 'www.x.com')).toBe('removed');
    expect(await v.removeProjectDomain('p', 'x.com')).toBe('absent');
    expect(calls[0]).toMatchObject({ url: 'https://api.vercel.com/v9/projects/p/domains/www.x.com', method: 'DELETE' });
  });
});

describe('owned(): only a live registration bought through Vercel counts', () => {
  it.each([
    ['not bought through Vercel', { boughtAt: null, expiresAt: null, renew: false }],
    ['expired', { boughtAt: 1, expiresAt: 1_000, renew: true }],
    ['no expiry', { boughtAt: 1, expiresAt: null, renew: true }],
  ])('%s → null', async (_n, domain) => {
    const { f } = fakeFetch([{ status: 200, body: { domain } }]);
    expect(await makeVercelDomains({ token: 't', fetch: f, now: () => 2_000 }).owned('x.com')).toBeNull();
  });

  it('an outage throws (never read as "gone")', async () => {
    const { f } = fakeFetch([{ status: 500, body: { code: 'internal_server_error' } }]);
    await expect(makeVercelDomains({ token: 't', fetch: f }).owned('x.com')).rejects.toMatchObject({ status: 500 });
  });
});

describe('listDomains (admin, read-only)', () => {
  it('pages with until=pagination.next and only GETs', async () => {
    const { f, calls } = fakeFetch([
      { status: 200, body: { domains: [{ name: 'a.com', boughtAt: 1, expiresAt: 2, renew: true, serviceType: 'zeit.world' }], pagination: { next: 99 } } },
      { status: 200, body: { domains: [{ name: 'b.com', boughtAt: null, expiresAt: null, renew: false }], pagination: { next: null } } },
    ]);
    const list = await makeVercelDomains({ token: 't', fetch: f }).listDomains();
    expect(list.map((d) => d.name)).toEqual(['a.com', 'b.com']);
    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET https://api.vercel.com/v5/domains?limit=100',
      'GET https://api.vercel.com/v5/domains?limit=100&until=99',
    ]);
  });
});

describe('registrantContact (env VERCEL_REGISTRANT_CONTACT)', () => {
  it('parses a complete contact', () => expect(registrantContact(JSON.stringify(CONTACT))).toEqual(CONTACT));
  it.each([
    [undefined], [''], ['not json'], [JSON.stringify({ ...CONTACT, phone: '555-0100' })],
    [JSON.stringify({ ...CONTACT, country: 'usa' })], [JSON.stringify({ ...CONTACT, phone: '+1555' })], [JSON.stringify({ ...CONTACT, zip: '' })], [JSON.stringify({ ...CONTACT, email: 'nope' })],
  ])('rejects %s', (raw) => expect(registrantContact(raw as any)).toBeNull());
});
