// Draft GET/PUT: browsers (no X-PB-Build) are unchanged with every switch in every state; natives need account mode; DRAFT_PUT_KEEPS_LIVE_URL.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ calls: [] as any[], draft: null as any, kind: 'web' as string, kindFails: false, kindCalls: 0 }));
vi.mock('../../lib/webApp/webAppServer.js', () => ({
  webAppCors: () => false, webAppCheckoutOn: () => true,
  callerFrom: async () => ({ id: 'u1', email: 'o@example.com' }),
  sbRest: async (path: string, init: any = {}) => {
    db.calls.push({ path, method: init.method ?? 'GET', body: init.body });
    if (path.startsWith('web_app_drafts')) {
      if ((init.method ?? 'GET') === 'GET') return db.draft ? [db.draft] : [];
      if (init.method === 'PATCH') return [{ ...db.draft, ...init.body }];
      return [{ ...init.body }];
    }
    return [];
  },
}));
vi.mock('../../lib/account/kind.js', async (orig) => ({
  ...(await orig<typeof import('../../lib/account/kind.js')>()),
  accountKind: async () => { db.kindCalls++; if (db.kindFails) throw new Error('db'); return db.kind; },
}));

import handler from '../../api/web-app/draft.js';

const res = () => { const r: any = { code: 0, body: null, headers: {} }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; r.setHeader = (k: string, v: string) => { r.headers[k] = v; }; r.end = () => r; return r; };
const run = async (method: string, headers: any = {}, body?: any) => { const r = res(); await handler({ method, headers: { authorization: 'Bearer t', ...headers }, body }, r); return r; };
const site = () => ({ shopName: 'Fresh Cuts', area: 'Brooklyn', phone: '555', hero: { heading: 'H', tagline: 'T', imageUrl: '' }, about: { heading: 'A', description: ['d'], imageUrl: '' }, services: [{ title: 'Fade', name: 'Fade', price: '$30', imageUrl: '' }], gallery: [], craftImages: [], staff: [], contact: { address: '1 Main St', email: 'a@b.co' } });
const existing = () => ({ user_id: 'u1', environment: 'test', draft_id: 'd1', revision: 1, site_data: { ...site(), source: 'web-app', shopName: 'Old' }, deployed_url: 'https://old.vercel.app', published_binding: null, updated_at: 'x', suspended: false });
const put = (over: any = {}) => ({ id: 'd1', expectedRevision: 1, site_data: site(), ...over });

const STATES: Record<string, Record<string, string>> = { off: {}, allowlist: { ACCOUNT_DRAFTS_IOS: 'allowlist', ACCOUNT_DRAFTS_IOS_USERS: 'u1' }, all: { ACCOUNT_DRAFTS_IOS: 'all' } };

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('WEB_APP_RELIABILITY', '1'); vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x'); vi.stubEnv('SUPABASE_URL', 'https://sb.test'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'k');
  Object.assign(db, { calls: [], draft: existing(), kind: 'web', kindFails: false, kindCalls: 0 });
});
afterEach(() => vi.unstubAllEnvs());

describe('browser requests are unchanged by ACCOUNT_DRAFTS_IOS in every state', () => {
  it('GET and PUT: same answers, same database calls, and the kind is never read', async () => {
    const seen: Record<string, string> = {};
    for (const [name, env] of Object.entries(STATES)) {
      vi.unstubAllEnvs();
      for (const [k, v] of Object.entries({ WEB_APP_RELIABILITY: '1', STRIPE_WEBAPP_SECRET_KEY: 'sk_test_x', ...env })) vi.stubEnv(k, v);
      db.calls = []; db.draft = existing();
      const g = await run('GET');
      const p = await run('PUT', {}, put());
      seen[name] = JSON.stringify({ g: [g.code, g.body], p: [p.code, p.body.draft?.revision], calls: db.calls.map((c) => [c.path, c.method, c.body && Object.keys(c.body).sort()]) });
    }
    expect(new Set(Object.values(seen)).size).toBe(1);
    expect(db.kindCalls).toBe(0);
  });
});

describe('native callers', () => {
  const hdr = { 'x-pb-build': '57' };
  it('web account, switch off: 403 not-account-mode (web-only), and nothing is written', async () => {
    const r = await run('PUT', hdr, put());
    expect(r.code).toBe(403); expect(r.body).toEqual({ error: 'not-account-mode' });
    expect(db.calls.filter((c) => c.method !== 'GET')).toEqual([]);
    expect((await run('GET', hdr)).code).toBe(403);
  });
  it('web account in the allowlist or with all: GET and PUT work as for a browser', async () => {
    for (const env of [STATES.allowlist, STATES.all]) {
      vi.unstubAllEnvs();
      for (const [k, v] of Object.entries({ WEB_APP_RELIABILITY: '1', STRIPE_WEBAPP_SECRET_KEY: 'sk_test_x', ...env })) vi.stubEnv(k, v);
      expect((await run('GET', hdr)).code).toBe(200);
      expect((await run('PUT', hdr, put())).code).toBe(200);
    }
  });
  it('apple, mixed and neither accounts are 403 even with all', async () => {
    vi.stubEnv('ACCOUNT_DRAFTS_IOS', 'all');
    for (const kind of ['apple', 'mixed', 'neither']) { db.kind = kind; expect((await run('GET', hdr)).code).toBe(403); }
  });
  it('a lookup failure is 503, never device behaviour', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.stubEnv('ACCOUNT_DRAFTS_IOS', 'all'); db.kindFails = true;
    const r = await run('PUT', hdr, put());
    expect(r.code).toBe(503);
    expect(db.calls.filter((c) => c.method !== 'GET')).toEqual([]);
  });
});

describe('DRAFT_PUT_KEEPS_LIVE_URL', () => {
  const patch = () => db.calls.find((c) => c.method === 'PATCH');
  it('off: the PUT row writes the address it read (today)', async () => {
    expect((await run('PUT', {}, put())).code).toBe(200);
    expect(patch().body.deployed_url).toBe('https://old.vercel.app');
  });
  it('on: an existing draft\'s PUT row has no deployed_url, so a publish in between is not overwritten; the answer shows the database value', async () => {
    vi.stubEnv('DRAFT_PUT_KEEPS_LIVE_URL', '1');
    const r = await run('PUT', {}, put());
    expect(r.code).toBe(200);
    expect('deployed_url' in patch().body).toBe(false);
    expect(r.body.draft.deployedUrl ?? r.body.draft.deployed_url).toBe('https://old.vercel.app');
  });
  it('on: the first insert is unchanged (it inherits the live binding or null)', async () => {
    vi.stubEnv('DRAFT_PUT_KEEPS_LIVE_URL', '1');
    db.draft = null;
    expect((await run('PUT', {}, put({ expectedRevision: 0 }))).code).toBe(200);
    const post = db.calls.find((c) => c.method === 'POST');
    expect(post.body.deployed_url).toBeNull();
  });
});
