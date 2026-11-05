// Orphan protection: svcCopy follows the services on every web draft save and publish snapshot, and a removed service retires its cache.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const st = vi.hoisted(() => ({ previous: null as any, writes: [] as { path: string; init: any }[], enabled: false, failCache: false }));
vi.mock('../../lib/webApp/webAppServer.js', () => ({
  webAppCors: () => false, webAppCheckoutOn: () => true, webAppEntitlementsOn: () => true, APP_ORIGIN: () => 'https://app.test',
  callerFrom: async () => ({ id: '10000000-0000-0000-0000-000000000001', email: 't@example.com' }),
  sbRest: async (path: string, init: any = {}) => { st.writes.push({ path, init }); if (st.failCache && path.startsWith('ab_service_copy')) throw new Error('relation does not exist'); if ((init.method ?? 'GET') === 'PATCH') return [{ draft_id: 'd1', revision: 2, site_data: JSON.parse(JSON.stringify(init.body.site_data)), updated_at: 'now', deployed_url: null }]; return null; },
  readRawBody: async () => '',
}));
vi.mock('../../lib/webApp/reliability.js', async (orig) => ({ ...(await orig<any>()), reliabilityOn: () => true, modeOf: () => 'test', readDraft: async () => st.previous, publishedBinding: async () => null }));
import draft from '../../api/web-app/draft';
import { svcCopySanitize, serviceKeys } from '../../lib/serviceCopy/prune';
import { validateWebSnapshot } from '../../lib/webApp/publishFlow';
import { GOOD_JSON, site } from './helpers';

const entry = { v: 1, aiGenerated: true, approval: 'owner', ...GOOD_JSON };
const withCopy = (titles: string[], svcCopy: any) => site({ extraPages: { on: ['faq'], serviceGuides: true, seed: 7, svcCopy } }, titles);
const response = () => { const r: any = { code: 0, body: null, setHeader: vi.fn() }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; return r; };

describe('svcCopySanitize', () => {
  it('keeps entries of real services, drops orphans, bad shapes and prototype keys; same object when nothing changes', () => {
    const d = withCopy(['Scalp Massage', 'Eyebrow Styling'], { 'scalp massage': entry, 'removed service': entry, 'eyebrow styling': { ...entry, v: 2 } });
    const out = svcCopySanitize(d);
    expect(out.dropped.sort()).toEqual(['eyebrow styling', 'removed service']);
    expect(Object.keys(out.siteData.extraPages.svcCopy)).toEqual(['scalp massage']);
    expect(d.extraPages.svcCopy['removed service']).toBeDefined(); // never mutates
    const clean = withCopy(['Scalp Massage'], { 'scalp massage': entry });
    expect(svcCopySanitize(clean).siteData).toBe(clean);
    expect(svcCopySanitize(site()).siteData).toBeDefined();
  });
  it('removes a svcCopy that is not an object; removes the key when nothing is left', () => {
    for (const bad of ['x', 5, [], null]) expect(svcCopySanitize(withCopy(['Scalp Massage'], bad)).siteData.extraPages).not.toHaveProperty('svcCopy');
    expect(svcCopySanitize(withCopy(['Scalp Massage'], { gone: entry })).siteData.extraPages).not.toHaveProperty('svcCopy');
  });
  it('renaming a service orphans the old key: the text cannot resurface under the new title', () => {
    const renamed = withCopy(['Scalp Ritual'], { 'scalp massage': entry });
    expect(svcCopySanitize(renamed).siteData.extraPages.svcCopy).toBeUndefined();
  });
  it('serviceKeys lists the title keys', () => { expect([...serviceKeys(site({}, ['Scalp Massage']))].sort()).toEqual(['scalp massage', 'skin fade']); });
  it('a hostile svcCopy never throws', () => {
    for (const d of [null, undefined, 5, {}, { extraPages: null }, { extraPages: { svcCopy: { __proto__: entry } }, services: 'x' }]) expect(() => svcCopySanitize(d as any)).not.toThrow();
  });
});

describe('publish snapshot', () => {
  it('prunes orphan AI text before the render', () => {
    const r = validateWebSnapshot(withCopy(['Scalp Massage'], { 'scalp massage': entry, orphan: entry }), () => []);
    expect(Object.keys((r.sd.extraPages as any).svcCopy)).toEqual(['scalp massage']);
    expect(Object.keys((r.pendingData.extraPages as any).svcCopy)).toEqual(['scalp massage']);
  });
});

describe('draft save', () => {
  beforeEach(() => { st.failCache = false; st.writes = []; process.env.SERVICE_COPY_AI = ''; process.env.STRIPE_WEBAPP_SECRET_KEY = 'sk_test_dummy'; });
  const put = async (siteData: any) => { const r = response(); await draft({ method: 'PUT', headers: { authorization: 'Bearer t' }, body: { id: 'd1', site_data: siteData, expectedRevision: 1 } }, r); return r; };
  const prev = (siteData: any) => ({ user_id: 'u', environment: 'test', draft_id: 'd1', revision: 1, site_data: siteData, deployed_url: null });
  it('stores only entries of services that exist', async () => {
    st.previous = prev(withCopy(['Scalp Massage'], { 'scalp massage': entry }));
    const r = await put(withCopy(['Scalp Massage'], { 'scalp massage': entry, orphan: entry, 'skin fade': 'junk' }));
    expect(r.code).toBe(200);
    expect(Object.keys(r.body.draft.site_data.extraPages.svcCopy)).toEqual(['scalp massage']);
  });
  it('model text with no owner approval never reaches the stored draft; "auto" text only while SERVICE_COPY_AUTO_PUBLISH is on; owner text and families stay', async () => {
    const proposal = { v: 1, aiGenerated: true, ...GOOD_JSON };
    const auto = { ...proposal, approval: 'auto' };
    st.previous = prev(withCopy(['Scalp Massage'], undefined));
    delete process.env.SERVICE_COPY_AUTO_PUBLISH;
    for (const e of [proposal, auto]) {
      const r = await put(withCopy(['Scalp Massage'], { 'scalp massage': e }));
      expect(r.code).toBe(200);
      expect(r.body.draft.site_data.extraPages.svcCopy).toBeUndefined();
    }
    expect(Object.keys((await put(withCopy(['Scalp Massage'], { 'scalp massage': entry }))).body.draft.site_data.extraPages.svcCopy)).toEqual(['scalp massage']);
    const fam = site({ extraPages: { on: ['faq'], serviceGuides: true, seed: 7, svcFamily: { 'scalp massage': 'shave', 'gone': 'shave' } } }, ['Scalp Massage']);
    expect((await put(fam)).body.draft.site_data.extraPages.svcFamily).toEqual({ 'scalp massage': 'shave' });
    process.env.SERVICE_COPY_AUTO_PUBLISH = '1';
    try {
      expect(Object.keys((await put(withCopy(['Scalp Massage'], { 'scalp massage': auto }))).body.draft.site_data.extraPages.svcCopy)).toEqual(['scalp massage']);
      expect((await put(withCopy(['Scalp Massage'], { 'scalp massage': proposal }))).body.draft.site_data.extraPages.svcCopy).toBeUndefined();
    } finally { delete process.env.SERVICE_COPY_AUTO_PUBLISH; }
  });
  it('removing a service retires its cached text (only when the feature is on); no cleanup call otherwise', async () => {
    st.previous = prev(withCopy(['Scalp Massage'], { 'scalp massage': entry }));
    await put(withCopy([], undefined));
    expect(st.writes.some((w) => w.path.startsWith('ab_service_copy'))).toBe(false);
    process.env.SERVICE_COPY_AI = '1';
    st.writes = [];
    const r = await put(withCopy([], undefined));
    expect(r.code).toBe(200);
    const del = st.writes.find((w) => w.path.startsWith('ab_service_copy'));
    expect(del?.init.method).toBe('DELETE');
    expect(decodeURIComponent(del!.path)).toContain('title_key=in.("scalp massage","family:scalp massage")');
    expect(del!.path).toContain('draft_id=eq.d1');
  });
  it('a failing cleanup never fails the save', async () => {
    process.env.SERVICE_COPY_AI = '1';
    st.previous = prev(withCopy(['Scalp Massage'], undefined));
    st.failCache = true;
    const r = await put(withCopy([], undefined));
    expect(r.code).toBe(200);
    expect(st.writes.some((w) => w.path.startsWith('ab_service_copy'))).toBe(true); // it was tried and failed quietly
  });
});
