import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, string>();
const deleted: string[] = [];
vi.mock('@google-cloud/storage', () => ({
  Storage: class {
    bucket() {
      return {
        file: (name: string) => ({
          save: async (data: string) => { store.set(name, data); },
          delete: async () => { deleted.push(name); store.delete(name); },
        }),
      };
    }
  },
}));

import { savePendingSite } from '../api/save-pending-site.js';

function res() {
  const r: any = { statusCode: 0, body: undefined, headers: {} as Record<string, string> };
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; return r; };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  r.end = () => r;
  return r;
}

const deps = (bound: string[] | Error = [], published: string[] | Error = []) => ({
  isAppSlug: vi.fn(async (slug: string) => { if (bound instanceof Error) throw bound; return bound.includes(slug); }),
  isPublished: vi.fn(async (slug: string) => { if (published instanceof Error) throw published; return published.includes(slug); }),
});
const call = async (req: any, d = deps()) => { const r = res(); await savePendingSite(req, r, d); return r; };

beforeEach(() => {
  store.clear();
  deleted.length = 0;
  process.env.GCS_BUCKET_NAME = 'b';
  process.env.GCS_CREDENTIALS = JSON.stringify({ project_id: 'p' });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('api/save-pending-site', () => {
  it('web sites save as before', async () => {
    const r = await call({ method: 'POST', body: { siteId: 'web-shop', data: { siteId: 'web-shop', siteData: { shopName: 'W' } } } });
    expect(r).toMatchObject({ statusCode: 200, body: { ok: true } });
    expect(JSON.parse(store.get('pending-sites/web-shop.json')!).data.siteData.shopName).toBe('W');
  });

  it('never stores the server-only version fields a client sends', async () => {
    await call({ method: 'POST', body: { siteId: 'web-shop', data: {
      siteId: 'web-shop', siteData: {}, version: 999, editedBy: 'admin', editedAt: 'x', adminVersion: 999, note: 'n', deployedUrl: 'https://u',
    } } });
    const data = JSON.parse(store.get('pending-sites/web-shop.json')!).data;
    // deployedUrl is server-owned too: a client stamp told the sweeper a live site was not live.
    expect(data).toEqual({ siteId: 'web-shop', siteData: {} });
  });

  it('a published web site (stamped copy) → 409 site-published for POST and DELETE, nothing written or deleted', async () => {
    store.set('pending-sites/fresh-cuts.json', 'original');
    const d = deps([], ['fresh-cuts']);
    const post = await call({ method: 'POST', body: { siteId: 'fresh-cuts', data: { siteData: { shopName: 'phish' }, deployedUrl: 'https://nothing.example' } } }, d);
    expect(post).toMatchObject({ statusCode: 409, body: { ok: false, error: 'site-published' } });
    const del = await call({ method: 'DELETE', body: { siteId: 'fresh-cuts' } }, d);
    expect(del.statusCode).toBe(409);
    expect(store.get('pending-sites/fresh-cuts.json')).toBe('original');
    expect(deleted).toEqual([]);
  });

  it('a failed read of the stored copy refuses (503), never writes', async () => {
    const r = await call({ method: 'POST', body: { siteId: 'fresh-cuts', data: { siteData: {} } } }, deps([], new Error('gcs down')));
    expect(r).toMatchObject({ statusCode: 503, body: { ok: false, error: 'lookup-failed' } });
    expect(store.size).toBe(0);
  });

  it('POST and DELETE on an iOS app slug → 409 slug-taken, nothing written or deleted', async () => {
    const d = deps(['fade-lab']);
    const post = await call({ method: 'POST', body: { siteId: 'fade-lab', data: { siteData: {} } } }, d);
    expect(post).toMatchObject({ statusCode: 409, body: { ok: false, error: 'slug-taken' } });
    const del = await call({ method: 'DELETE', body: { siteId: 'Fade-Lab' } }, d);
    expect(del).toMatchObject({ statusCode: 409, body: { error: 'slug-taken' } });
    expect(d.isAppSlug).toHaveBeenCalledWith('fade-lab');
    expect(store.size).toBe(0);
    expect(deleted).toEqual([]);
  });

  it('a failed lookup refuses (503) rather than risk overwriting an app site', async () => {
    const r = await call({ method: 'POST', body: { siteId: 'web-shop', data: { siteData: {} } } }, deps(new Error('db down')));
    expect(r).toMatchObject({ statusCode: 503, body: { ok: false, error: 'lookup-failed' } });
    expect(store.size).toBe(0);
    const d = await call({ method: 'DELETE', body: { siteId: 'web-shop' } }, deps(new Error('db down')));
    expect(d.statusCode).toBe(503);
    expect(deleted).toEqual([]);
  });

  it('writes, deletes and checks one canonical key: the object the server reads (review finding 1)', async () => {
    const S = 'a'.repeat(45) + '-bcd';
    const d = deps([], [S]);
    // The 50-character client slug ends with a dash; the published check and the write both use S.
    const r = await call({ method: 'POST', body: { siteId: S + '-', data: { siteData: {} } } }, d);
    expect(r.statusCode).toBe(409);
    expect(d.isPublished).toHaveBeenCalledWith(S);
    const r2 = await call({ method: 'POST', body: { siteId: 'Web_Shop', data: { siteData: {} } } });
    expect(r2.statusCode).toBe(200);
    expect([...store.keys()]).toEqual(['pending-sites/web-shop.json']);
  });

  it('a 500 carries a fixed message, never the error text', async () => {
    delete process.env.GCS_CREDENTIALS;
    process.env.GCP_SERVICE_ACCOUNT_JSON = '{not json';
    const r = await call({ method: 'POST', body: { siteId: 'web-shop', data: { siteData: {} } } });
    delete process.env.GCP_SERVICE_ACCOUNT_JSON;
    expect(r).toMatchObject({ statusCode: 500, body: { ok: false, error: 'Internal error' } });
  });

  it('DELETE of a web site still works', async () => {
    const r = await call({ method: 'DELETE', body: { siteId: 'web-shop' } });
    expect(r.statusCode).toBe(200);
    expect(deleted).toEqual(['pending-sites/web-shop.json']);
  });
});
