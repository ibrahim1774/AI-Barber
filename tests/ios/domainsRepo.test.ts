import { describe, it, expect } from 'vitest';
import { supabaseDomains } from '../../lib/ios/domainsRepo.js';

type Call = { method: string; args: unknown[] };

function fakeClient(result: { data: unknown; error: unknown } = { data: [], error: null }) {
  const calls: Call[] = [];
  const chain: any = { then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(result).then(res, rej) };
  for (const m of ['select', 'update', 'eq', 'is', 'not', 'or', 'gt', 'in', 'order', 'limit']) {
    chain[m] = (...args: unknown[]) => { calls.push({ method: m, args }); return chain; };
  }
  return { client: { from: (t: string) => { calls.push({ method: 'from', args: [t] }); return chain; } } as any, calls };
}
const find = (calls: Call[], m: string) => calls.find((c) => c.method === m);

describe('supabaseDomains owner-removed handling', () => {
  it('reattachCandidates filters out the owner-removed mark in SQL', async () => {
    const { client, calls } = fakeClient();
    await supabaseDomains(client).reattachCandidates(5, 1_800_000_000_000);
    expect(find(calls, 'or')!.args).toEqual(['failure_reason.is.null,failure_reason.neq.owner-removed']);
    expect(find(calls, 'eq')!.args).toEqual(['state', 'detached']);
  });

  it('clearOwnerRemoved clears the mark only on detached owner-removed rows of the slug', async () => {
    const { client, calls } = fakeClient();
    await supabaseDomains(client).clearOwnerRemoved('fresh-cuts');
    expect(find(calls, 'update')!.args[0]).toMatchObject({ failure_reason: null });
    const eqs = calls.filter((c) => c.method === 'eq').map((c) => c.args);
    expect(eqs).toContainEqual(['site_slug', 'fresh-cuts']);
    expect(eqs).toContainEqual(['state', 'detached']);
    expect(eqs).toContainEqual(['failure_reason', 'owner-removed']);
  });
});
