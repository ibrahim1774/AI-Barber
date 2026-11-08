import { describe, it, expect, vi } from 'vitest';
import { saveContactPhone, maskPhone, type ContactPhoneDeps } from '../../lib/webApp/contactPhone.js';

function mk(over: Partial<ContactPhoneDeps> = {}) {
  const upserts: any[] = [];
  const logs: string[] = [];
  const deps: ContactPhoneDeps = {
    callerFrom: async () => ({ id: 'u1aaaaaa-0000', email: 'a@example.com' }),
    mode: 'live',
    now: () => '2026-11-08T00:00:00.000Z',
    upsertContact: async (r) => { upserts.push(r); },
    stampSite: vi.fn(async () => 'my-shop'),
    syncAuthPhone: vi.fn(async () => 'synced' as const),
    mergeMetadataPhone: vi.fn(async () => {}),
    log: (m) => logs.push(m),
    ...over,
  };
  return { deps, upserts, logs };
}

describe('saveContactPhone', () => {
  it('401 with no caller, and touches nothing', async () => {
    const { deps, upserts } = mk({ callerFrom: async () => null });
    const r = await saveContactPhone(undefined, { phone: '5552345678' }, deps);
    expect(r).toEqual({ status: 401, body: { error: 'unauthorized' } });
    expect(upserts).toHaveLength(0);
    expect(deps.syncAuthPhone).not.toHaveBeenCalled();
  });
  it('400 invalid_phone and nothing stored', async () => {
    const { deps, upserts } = mk();
    for (const body of [{ phone: '123' }, { phone: 'abc' }, {}, null, 'x']) {
      expect(await saveContactPhone('Bearer t', body, deps)).toEqual({ status: 400, body: { error: 'invalid_phone' } });
    }
    expect(upserts).toHaveLength(0);
  });
  it('405 for a non-POST method', async () => {
    const { deps } = mk();
    expect((await saveContactPhone('Bearer t', { phone: '5552345678' }, deps, 'GET')).status).toBe(405);
  });
  it('stores the normalized number, stamps the site, syncs auth and metadata', async () => {
    const { deps, upserts } = mk();
    const r = await saveContactPhone('Bearer t', { phone: '(555) 234-5678' }, deps);
    expect(r).toEqual({ status: 200, body: { ok: true, phone: '+15552345678' } });
    expect(upserts[0]).toMatchObject({ user_id: 'u1aaaaaa-0000', phone_e164: '+15552345678', source: 'post_pay_web', environment: 'live', site_slug: 'my-shop', auth_phone_synced: false });
    expect(upserts[upserts.length - 1].auth_phone_synced).toBe(true);
    expect(deps.stampSite).toHaveBeenCalledWith('u1aaaaaa-0000', 'live', '+15552345678', '2026-11-08T00:00:00.000Z');
    expect(deps.syncAuthPhone).toHaveBeenCalledWith('u1aaaaaa-0000', '+15552345678');
    expect(deps.mergeMetadataPhone).toHaveBeenCalledWith('u1aaaaaa-0000', '+15552345678');
  });
  it('auth unique-phone conflict still answers 200 with no hint, keeps the contact, leaves synced=false', async () => {
    const { deps, upserts, logs } = mk({ syncAuthPhone: vi.fn(async () => 'conflict' as const) });
    const r = await saveContactPhone('Bearer t', { phone: '5552345678' }, deps);
    expect(r).toEqual({ status: 200, body: { ok: true, phone: '+15552345678' } });
    expect(JSON.stringify(r)).not.toMatch(/conflict|already|used|taken|exists/i);
    expect(upserts.every((u) => u.auth_phone_synced === false)).toBe(true);
    expect(deps.mergeMetadataPhone).toHaveBeenCalled();
    expect(logs.join('\n')).not.toContain('+15552345678');
  });
  it('an auth sync that throws is identical to a conflict for the caller', async () => {
    const a = mk({ syncAuthPhone: async () => { throw new Error('boom'); } });
    const b = mk({ syncAuthPhone: async () => 'conflict' });
    expect(await saveContactPhone('Bearer t', { phone: '5552345678' }, a.deps)).toEqual(await saveContactPhone('Bearer t', { phone: '5552345678' }, b.deps));
  });
  it('500 save_failed when the contact cannot be stored; never touches auth', async () => {
    const { deps } = mk({ upsertContact: async () => { throw Object.assign(new Error('x'), { status: 500 }); } });
    expect(await saveContactPhone('Bearer t', { phone: '5552345678' }, deps)).toEqual({ status: 500, body: { error: 'save_failed' } });
    expect(deps.syncAuthPhone).not.toHaveBeenCalled();
  });
  it('a failing site stamp or metadata merge does not fail the save', async () => {
    const { deps, upserts } = mk({ stampSite: async () => { throw new Error('x'); }, mergeMetadataPhone: async () => { throw new Error('y'); } });
    expect((await saveContactPhone('Bearer t', { phone: '5552345678' }, deps)).status).toBe(200);
    expect(upserts[0].site_slug).toBeNull();
  });
  it('never logs a full number', async () => {
    const { deps, logs } = mk({ syncAuthPhone: async () => 'error', stampSite: async () => { throw new Error('x'); } });
    await saveContactPhone('Bearer t', { phone: '5552345678' }, deps);
    expect(logs.length).toBeGreaterThan(0);
    expect(logs.join('\n')).not.toContain('5552345678');
    expect(maskPhone('+15552345678')).toBe('+1•••••••678');
  });
});
