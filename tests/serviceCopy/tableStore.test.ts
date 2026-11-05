import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
const calls = vi.hoisted(() => ({ list: [] as { path: string; init: any }[], next: null as any, fail: false }));
vi.mock('../../lib/webApp/webAppServer.js', () => ({ sbRest: async (path: string, init: any = {}) => { calls.list.push({ path, init }); if (calls.fail) throw Object.assign(new Error('supabase 404'), { status: 404 }); return calls.next; } }));
import { StoreError, tableCopyStore } from '../../lib/serviceCopy/store';

const k = { userId: 'u1', draftId: 'd1', titleKey: "o'brien \"cut\"" };
describe('table store', () => {
  it('claims with insert-ignore-duplicates, finishes only for the claim holder, releases only its own pending row', async () => {
    calls.list = []; calls.next = [{ title_key: 'x' }];
    expect(await tableCopyStore.claim(k, 'tok', 'h'.repeat(64), 1_000)).toBe(true);
    expect(calls.list[0].init.prefer).toContain('ignore-duplicates');
    calls.next = [];
    expect(await tableCopyStore.claim(k, 'tok', 'h', 1)).toBe(false);
    await tableCopyStore.finish(k, 'tok', { v: 1 } as any, { tokensIn: 1, tokensOut: 2 });
    const fin = calls.list[calls.list.length - 1];
    expect(fin.path).toContain('state=eq.pending'); expect(fin.path).toContain('claim_token=eq.tok'); expect(fin.init.method).toBe('PATCH');
    await tableCopyStore.release(k, 'tok');
    const rel = calls.list[calls.list.length - 1];
    expect([rel.init.method, rel.path.includes('state=eq.pending'), rel.path.includes('claim_token=eq.tok')]).toEqual(['DELETE', true, true]);
  });
  it('keys are URL-encoded; removeMany quotes each key', async () => {
    calls.list = []; calls.next = [];
    await tableCopyStore.remove(k);
    expect(calls.list[0].path).toContain(encodeURIComponent(k.titleKey));
    await tableCopyStore.removeMany('u1', 'd1', ['a,b', 'c"d)']);
    expect(decodeURIComponent(calls.list[1].path)).toContain('title_key=in.("a,b","family:a,b","c\\"d)","family:c\\"d)")');
  });
  it('approve flips only a finished, not yet owner-approved row, to owner; a family row is a separate key', async () => {
    calls.list = []; calls.next = [{ title_key: 'x' }];
    expect(await tableCopyStore.approve(k)).toBe(true);
    const ap = calls.list[0];
    expect([ap.init.method, ap.init.body]).toEqual(['PATCH', { approval: 'owner' }]);
    expect(ap.path).toContain('state=eq.done');
    expect(decodeURIComponent(ap.path)).toContain('or=(approval.is.null,approval.eq.auto)');
    calls.next = [];
    expect(await tableCopyStore.approve(k)).toBe(false);
    await tableCopyStore.get({ ...k, kind: 'family' });
    expect(decodeURIComponent(calls.list[calls.list.length - 1].path)).toContain(`title_key=eq.family:${k.titleKey}`);
  });
  it('any failure (a missing table before migration 028) is a StoreError, never a raw error', async () => {
    calls.fail = true;
    await expect(tableCopyStore.get(k)).rejects.toBeInstanceOf(StoreError);
    await expect(tableCopyStore.claim(k, 't', 'h', 1)).rejects.toBeInstanceOf(StoreError);
    calls.fail = false;
  });
  it('a malformed row is a StoreError', async () => {
    calls.next = [{ state: 'weird', facts_hash: 'x' }];
    await expect(tableCopyStore.get(k)).rejects.toBeInstanceOf(StoreError);
  });
  it('migration 028 is additive, locked down and consistent with the store', () => {
    const sql = readFileSync('supabase/migrations/028_service_copy.sql', 'utf8');
    expect(sql).toMatch(/create table if not exists public\.ab_service_copy/);
    expect(sql).toMatch(/primary key \(user_id, draft_id, title_key\)/);
    expect(sql).toMatch(/enable row level security/);
    expect(sql).toMatch(/revoke all on public\.ab_service_copy from public, anon, authenticated/);
    expect(sql).not.toMatch(/\b(drop|alter table public\.(?!ab_service_copy)|delete from|update )/i);
    for (const col of ['user_id', 'draft_id', 'title_key', 'state', 'claim_token', 'claimed_at', 'facts_hash', 'copy', 'tokens_in', 'tokens_out', 'finished_at']) expect(sql).toContain(col);
  });
});
