import { describe, expect, it, vi } from 'vitest';
import { checkTie, mayTakePurchase, type MayTakeDeps, type TieDeps } from '../../lib/account/mayTake.js';
import type { AddressRow } from '../../lib/account/sites.js';
import type { ApplePurchaseFact, EntitlementFact, WebSiteFact } from '../../lib/account/kind.js';

const UID = '11111111-1111-4111-8111-111111111111';
const NOW = Date.parse('2026-11-18T12:00:00Z');
const FUTURE = new Date(NOW + 30 * 86_400_000).toISOString();
const HOSTING = 'com.ibrahim1774.aibarber.hosting.monthly';

const apple = (over: Partial<ApplePurchaseFact> & { original_transaction_id: string }): ApplePurchaseFact => ({
  product_id: HOSTING, environment: 'Production', expires_at: FUTURE, revoked_at: null, taken_down_at: null, site_slug: null, published_at: null, user_id: UID, ...over,
});

function world(o: { web?: WebSiteFact[]; purchases?: ApplePurchaseFact[]; ents?: EntitlementFact[]; row?: AddressRow | null; env?: 'Production' | 'Sandbox'; incoming?: { user_id: string | null; environment?: string } } = {}) {
  const incoming = { original_transaction_id: 'NEW', user_id: null as string | null, environment: 'Production', ...(o.incoming ?? {}) };
  const deps: MayTakeDeps = {
    kindDeps: {
      webSites: async () => o.web ?? [],
      applePurchases: async () => o.purchases ?? [],
      entitlements: async () => o.ents ?? [],
      now: () => NOW,
    },
    env: () => o.env ?? 'Production',
    address: async () => o.row ?? null,
    purchase: async (otid) => (otid === 'NEW' ? incoming : (o.purchases ?? []).find((p) => p.original_transaction_id === otid) ?? null) as any,
    purchaseOfSlug: async (slug) => { const p = (o.purchases ?? []).find((x) => x.site_slug === slug); return p ? { original_transaction_id: p.original_transaction_id!, user_id: p.user_id ?? null } : null; },
  };
  return deps;
}
const web = (slug: string): WebSiteFact => ({ slug, published_at: '2026-10-01T00:00:00Z', removed_at: null, taken_down_at: null });
const card: EntitlementFact = { stripe_subscription_id: 'sub_1', status: 'active', tier: 'bookings' };

describe('mayTakePurchase', () => {
  it('an account with nothing may (a Free account that never published buys Apple)', async () => {
    expect(await mayTakePurchase(UID, 'NEW', world())).toEqual({ may: true });
  });
  it('a failed first web publish is not a web account: an unpublished web row does not block', async () => {
    const row: AddressRow = { user_id: UID, environment: 'Production', slug: 'x', holder: 'web', published_once: false };
    expect(await mayTakePurchase(UID, 'NEW', world({ row, web: [{ slug: 'x', published_at: null }] }))).toEqual({ may: true });
  });
  it('a web address (published, removed or not) is a web account: no, with its slug', async () => {
    expect(await mayTakePurchase(UID, 'NEW', world({ web: [web('cuts')] }))).toMatchObject({ may: false, reason: 'web-account', kind: 'web', slug: 'cuts', environment: 'Production' });
    expect(await mayTakePurchase(UID, 'NEW', world({ web: [{ ...web('cuts'), removed_at: '2026-11-01T00:00:00Z' }] }))).toMatchObject({ may: false, reason: 'web-account' });
  });
  it('a live card plan with no address on either side is a web account (slug null)', async () => {
    expect(await mayTakePurchase(UID, 'NEW', world({ ents: [card] }))).toMatchObject({ may: false, reason: 'web-account', slug: null });
  });
  it('a web address plus an Apple address is mixed: no, reason mixed', async () => {
    const p = apple({ original_transaction_id: 'OLD', site_slug: 'apple-site' });
    expect(await mayTakePurchase(UID, 'NEW', world({ web: [web('cuts')], purchases: [p] }))).toMatchObject({ may: false, reason: 'mixed', kind: 'mixed' });
  });
  it('the address sits on a different purchase (a different Apple ID): no, other-apple-id, with that slug (row)', async () => {
    const p = apple({ original_transaction_id: 'OLD', site_slug: 'apple-site' });
    const row: AddressRow = { user_id: UID, environment: 'Production', slug: 'apple-site', holder: 'apple', published_once: true };
    expect(await mayTakePurchase(UID, 'NEW', world({ purchases: [p], row }))).toMatchObject({ may: false, reason: 'other-apple-id', slug: 'apple-site' });
  });
  it('the same answer with no address row yet (the purchases decide)', async () => {
    const p = apple({ original_transaction_id: 'OLD', site_slug: 'apple-site' });
    expect(await mayTakePurchase(UID, 'NEW', world({ purchases: [p] }))).toMatchObject({ may: false, reason: 'other-apple-id', slug: 'apple-site' });
  });
  it('a removed Apple address still counts (removed or not)', async () => {
    const p = apple({ original_transaction_id: 'OLD', site_slug: 'apple-site', removed_at: '2026-11-01T00:00:00Z' });
    expect(await mayTakePurchase(UID, 'NEW', world({ purchases: [p] }))).toMatchObject({ may: false, reason: 'other-apple-id' });
  });
  it('the address sits on THIS purchase: yes', async () => {
    const p = apple({ original_transaction_id: 'NEW', site_slug: 'apple-site' });
    const row: AddressRow = { user_id: UID, environment: 'Production', slug: 'apple-site', holder: 'apple', published_once: true };
    expect(await mayTakePurchase(UID, 'NEW', world({ purchases: [p], row }))).toEqual({ may: true });
  });
  it('a purchase already linked to this account is never refused (nothing new is taken; a mixed account keeps today\'s behaviour)', async () => {
    const mine = apple({ original_transaction_id: 'NEW', site_slug: null });
    expect(await mayTakePurchase(UID, 'NEW', world({ web: [web('cuts')], purchases: [mine], incoming: { user_id: UID } }))).toEqual({ may: true });
  });
  it('the purchase\'s own environment decides (B6): a Production purchase ignores a Sandbox Apple address, a Sandbox purchase counts it; env() is not consulted', async () => {
    const p = apple({ original_transaction_id: 'OLD', site_slug: 'sbx', environment: 'Sandbox' });
    const noEnv = (d: MayTakeDeps): MayTakeDeps => ({ ...d, env: () => { throw new Error('STRIPE_WEBAPP_SECRET_KEY missing'); } });
    expect(await mayTakePurchase(UID, 'NEW', noEnv(world({ purchases: [p], incoming: { user_id: null, environment: 'Production' } })))).toEqual({ may: true });
    expect(await mayTakePurchase(UID, 'NEW', noEnv(world({ purchases: [p], incoming: { user_id: null, environment: 'Sandbox' } })))).toMatchObject({ may: false, reason: 'other-apple-id' });
  });
  it('a Sandbox purchase on a Production deployment for an account with only Sandbox history is judged against Sandbox rows (same environment as tryTake)', async () => {
    const row: AddressRow = { user_id: UID, environment: 'Sandbox', slug: 'sbx', holder: 'apple', published_once: true };
    const asked: string[] = [];
    const d = world({ env: 'Production', row, purchases: [apple({ original_transaction_id: 'OLD', site_slug: 'sbx', environment: 'Sandbox' })], incoming: { user_id: null, environment: 'Sandbox' } });
    const addr = d.address; d.address = async (u, e) => { asked.push(e); return addr(u, e); };
    expect(await mayTakePurchase(UID, 'NEW', d)).toMatchObject({ may: false, reason: 'other-apple-id' });
    expect(asked).toEqual(['Sandbox']);
  });
  it('a stale address row (its purchase now belongs to another account) never refuses the old account (B3a)', async () => {
    const row: AddressRow = { user_id: UID, environment: 'Production', slug: 'moved-away', holder: 'apple', published_once: true };
    const d = world({ row });
    d.purchaseOfSlug = async () => ({ original_transaction_id: 'OLD', user_id: 'someone-else' });
    expect(await mayTakePurchase(UID, 'NEW', d)).toEqual({ may: true });
    d.purchaseOfSlug = async () => ({ original_transaction_id: 'OLD', user_id: UID });
    expect(await mayTakePurchase(UID, 'NEW', d)).toMatchObject({ may: false, reason: 'other-apple-id' });
  });
  it('an account with an Apple address on a purchase and also a card plan: Apple holds it, another Apple ID is refused', async () => {
    const p = apple({ original_transaction_id: 'OLD', site_slug: 'apple-site' });
    expect(await mayTakePurchase(UID, 'NEW', world({ purchases: [p], ents: [card] }))).toMatchObject({ may: false, reason: 'other-apple-id' });
  });
  it('a read error propagates (checkTie decides what to do)', async () => {
    const d = world();
    d.kindDeps.webSites = async () => { throw new Error('boom'); };
    await expect(mayTakePurchase(UID, 'NEW', d)).rejects.toThrow('boom');
  });
});

describe('checkTie modes', () => {
  const refusal = { may: false as const, reason: 'web-account' as const, kind: 'web' as const, slug: 'cuts', environment: 'Production' as const };
  const mk = (mode: 'off' | 'alert' | 'enforce', d: any) => {
    const report = vi.fn(async () => {});
    const mayTake = vi.fn(async () => { if (d instanceof Error) throw d; return d; });
    const deps: TieDeps = { mode: () => mode, mayTake, report };
    return { deps, report, mayTake };
  };
  it('OFF: allow, and nothing is read or reported', async () => {
    const t = mk('off', refusal);
    expect(await checkTie(UID, 'NEW', 'x', t.deps)).toEqual({ action: 'allow' });
    expect(t.mayTake).not.toHaveBeenCalled();
    expect(t.report).not.toHaveBeenCalled();
  });
  it('ALERT: records and alerts (no email) and allows; it never refuses', async () => {
    const t = mk('alert', refusal);
    expect(await checkTie(UID, 'NEW', 'ios/publish', t.deps)).toEqual({ action: 'allow' });
    expect(t.report).toHaveBeenCalledWith({ otid: 'NEW', uid: UID, reason: 'web-account', slug: 'cuts', environment: 'Production', email: false, where: 'ios/publish' });
  });
  it('1: refuses with the account\'s slug, records, alerts and emails', async () => {
    const t = mk('enforce', refusal);
    expect(await checkTie(UID, 'NEW', 'x', t.deps)).toEqual({ action: 'refuse', reason: 'web-account', slug: 'cuts' });
    expect(t.report).toHaveBeenCalledWith(expect.objectContaining({ email: true }));
  });
  it('1: no address yet gives an empty slug', async () => {
    const t = mk('enforce', { ...refusal, slug: null });
    expect(await checkTie(UID, 'NEW', 'x', t.deps)).toEqual({ action: 'refuse', reason: 'web-account', slug: '' });
  });
  it('may: allow, nothing reported', async () => {
    const t = mk('enforce', { may: true });
    expect(await checkTie(UID, 'NEW', 'x', t.deps)).toEqual({ action: 'allow' });
    expect(t.report).not.toHaveBeenCalled();
  });
  it('a read error: alert allows (as today), 1 says unavailable; nothing is reported either way', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const a = mk('alert', new Error('db'));
    expect(await checkTie(UID, 'NEW', 'x', a.deps)).toEqual({ action: 'allow' });
    const e = mk('enforce', new Error('db'));
    expect(await checkTie(UID, 'NEW', 'x', e.deps)).toEqual({ action: 'unavailable' });
    expect(a.report).not.toHaveBeenCalled();
    expect(e.report).not.toHaveBeenCalled();
  });
});

describe('no barber email for the transfer tie points (B4)', () => {
  it('a refused Move or link records and alerts only', async () => {
    const report = vi.fn(async () => {});
    const deps: TieDeps = { mode: () => 'enforce', mayTake: async () => ({ may: false, reason: 'web-account', kind: 'web', slug: 'x', environment: 'Production' }), report };
    await checkTie(UID, 'NEW', 'ios/transfer move', deps);
    await checkTie(UID, 'NEW', 'ios/transfer link', deps);
    await checkTie(UID, 'NEW', 'ios/publish', deps);
    expect(report.mock.calls.map((c: any) => c[0].email)).toEqual([false, false, true]);
  });
});

describe('planLive on a web-account refusal', () => {
  it('a live card plan is live; no card plan and not Free is an ended plan; Free is live; a failed Free read counts as live', async () => {
    const base = (o: Parameters<typeof world>[0], isFree?: () => Promise<boolean>) => { const d = world(o); d.isFree = isFree; return d; };
    expect(await mayTakePurchase(UID, 'NEW', base({ web: [web('cuts')], ents: [card] }))).toMatchObject({ may: false, reason: 'web-account', planLive: true });
    expect(await mayTakePurchase(UID, 'NEW', base({ web: [web('cuts')] }, async () => false))).toMatchObject({ may: false, planLive: false });
    expect(await mayTakePurchase(UID, 'NEW', base({ web: [web('cuts')] }, async () => true))).toMatchObject({ planLive: true });
    expect(await mayTakePurchase(UID, 'NEW', base({ web: [web('cuts')] }, async () => { throw new Error('db'); }))).toMatchObject({ planLive: true });
  });
  it('checkTie hands planLive to the refusal and the report; other-apple-id has none', async () => {
    const report = vi.fn(async () => {});
    const deps: TieDeps = { mode: () => 'enforce', mayTake: async () => ({ may: false, reason: 'web-account', kind: 'web', slug: '', environment: 'Production', planLive: false }), report };
    expect(await checkTie(UID, 'NEW', 'ios/publish', deps)).toEqual({ action: 'refuse', reason: 'web-account', slug: '', planLive: false });
    expect(report).toHaveBeenCalledWith(expect.objectContaining({ planLive: false }));
    const other: TieDeps = { ...deps, mayTake: async () => ({ may: false, reason: 'other-apple-id', kind: 'apple', slug: 's', environment: 'Production' }) };
    expect(await checkTie(UID, 'NEW', 'x', other)).toEqual({ action: 'refuse', reason: 'other-apple-id', slug: 's' });
  });
});

