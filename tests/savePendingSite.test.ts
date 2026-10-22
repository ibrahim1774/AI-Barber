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

const deps = (bound: string[] | Error = []) => ({
  isAppSlug: vi.fn(async (slug: string) => { if (bound instanceof Error) throw bound; return bound.includes(slug); }),
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
    expect(data).toEqual({ siteId: 'web-shop', siteData: {}, deployedUrl: 'https://u' });
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

  it('DELETE of a web site still works', async () => {
    const r = await call({ method: 'DELETE', body: { siteId: 'web-shop' } });
    expect(r.statusCode).toBe(200);
    expect(deleted).toEqual(['pending-sites/web-shop.json']);
  });
});
