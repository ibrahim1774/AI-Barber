import { describe, it, expect, vi } from 'vitest';
import { sweepWebApp, sweepIosOverlap, type IosOverlapDeps, type OverlapRow, type WebSweepDeps } from '../../lib/webApp/lapse.js';
import type { WebSiteRow } from '../../lib/webApp/publishFlow.js';

const row = (over: Partial<WebSiteRow> = {}): WebSiteRow => ({
  slug: 's1', stripe_subscription_id: 'sub_1', user_id: 'u1', environment: 'live',
  published_at: '2026-10-01T00:00:00Z', taken_down_at: null, removed_at: null, ...over,
});

function fakes(o: { up?: WebSiteRow[]; down?: WebSiteRow[]; ios?: string[]; entitled?: string[]; status?: string | Error; customerActive?: boolean; deployErr?: any; publishOk?: boolean } = {}) {
  const deps: WebSweepDeps = {
    takedownCandidates: vi.fn(async () => o.up ?? []),
    restoreCandidates: vi.fn(async () => o.down ?? []),
    iosOwnsSlug: vi.fn(async (s) => (o.ios ?? []).includes(s)),
    hasEntitledRow: vi.fn(async (u) => (o.entitled ?? []).includes(u)),
    subscriptionStatus: vi.fn(async () => { if (o.status instanceof Error) throw o.status; return o.status ?? 'canceled'; }),
    customerHasActive: vi.fn(async () => o.customerActive ?? false),
    stampChecked: vi.fn(async () => {}),
    markTakenDown: vi.fn(async () => {}),
    clearTakenDown: vi.fn(async () => {}),
    deployOffline: vi.fn(async () => { if (o.deployErr) throw o.deployErr; }),
    publish: vi.fn(async (slug) => (o.publishOk === false ? { ok: false, siteId: slug, reason: 'deploy-failed' as const } : { ok: true, siteId: slug })),
    now: () => 0,
  };
  return deps;
}

describe('sweepWebApp', () => {
  it('takes down a site whose subscription is canceled: stamp first, then offline deploy', async () => {
    const d = fakes({ up: [row()] });
    const r = await sweepWebApp(d);
    expect(r.takenDown).toEqual(['s1']);
    expect(d.subscriptionStatus).toHaveBeenCalledWith('sub_1');
    const order = [(d.markTakenDown as any).mock.invocationCallOrder[0], (d.deployOffline as any).mock.invocationCallOrder[0]];
    expect(order[0]).toBeLessThan(order[1]);
  });

  it('leaves an iOS-owned slug alone', async () => {
    const d = fakes({ up: [row()], ios: ['s1'] });
    const r = await sweepWebApp(d);
    expect(r.skipped).toEqual(['s1']);
    expect(d.markTakenDown).not.toHaveBeenCalled();
    expect(d.subscriptionStatus).not.toHaveBeenCalled();
  });

  it('leaves a site alone while the user has any entitled web row', async () => {
    const d = fakes({ up: [row()], entitled: ['u1'] });
    const r = await sweepWebApp(d);
    expect(r.stillActive).toEqual(['s1']);
    expect(d.deployOffline).not.toHaveBeenCalled();
  });

  it('Stripe is the authority: an active subscription is not taken down; a lookup error stamps and skips', async () => {
    let d = fakes({ up: [row()], status: 'active' });
    expect((await sweepWebApp(d)).stillActive).toEqual(['s1']);
    expect(d.markTakenDown).not.toHaveBeenCalled();
    d = fakes({ up: [row()], status: new Error('stripe 500') });
    const r = await sweepWebApp(d);
    expect(r.stripeUnavailable).toEqual(['s1']);
    expect(d.stampChecked).toHaveBeenCalledWith('s1');
    expect(d.markTakenDown).not.toHaveBeenCalled();
  });

  it('a definite deploy failure clears the stamp; an indefinite one keeps it', async () => {
    let d = fakes({ up: [row()], deployErr: new Error('boom') });
    let r = await sweepWebApp(d);
    expect(r.takedownFailed).toEqual(['s1']);
    expect(d.clearTakenDown).toHaveBeenCalledWith('s1');
    d = fakes({ up: [row()], deployErr: Object.assign(new Error('timeout'), { indefinite: true }) });
    r = await sweepWebApp(d);
    expect(r.takedownUncertain).toEqual(['s1']);
    expect(d.clearTakenDown).not.toHaveBeenCalled();
  });

  it('restores a taken-down site when the user is entitled again, forced, and clears the stamp', async () => {
    const d = fakes({ down: [row({ taken_down_at: '2026-10-02T00:00:00Z' })], entitled: ['u1'] });
    const r = await sweepWebApp(d);
    expect(r.restored).toEqual(['s1']);
    expect(d.publish).toHaveBeenCalledWith('s1', { force: true });
    expect(d.clearTakenDown).toHaveBeenCalledWith('s1');
  });

  it('keeps the flag when the restore publish fails, and skips unentitled / iOS-owned rows', async () => {
    let d = fakes({ down: [row({ taken_down_at: 'x' })], entitled: ['u1'], publishOk: false });
    expect((await sweepWebApp(d)).restoreFailed).toEqual(['s1']);
    expect(d.clearTakenDown).not.toHaveBeenCalled();
    d = fakes({ down: [row({ taken_down_at: 'x' })] });
    await sweepWebApp(d);
    expect(d.publish).not.toHaveBeenCalled();
    d = fakes({ down: [row({ taken_down_at: 'x' })], entitled: ['u1'], ios: ['s1'] });
    await sweepWebApp(d);
    expect(d.publish).not.toHaveBeenCalled();
  });

  it('never considers removed or never-published rows even if the repo returns them', async () => {
    const d = fakes({ up: [row({ removed_at: 'x' }), row({ slug: 's2', published_at: null })] });
    await sweepWebApp(d);
    expect(d.deployOffline).not.toHaveBeenCalled();
  });

  it('keeps a site up when the customer has a newer active subscription (late webhook)', async () => {
    const d = fakes({ up: [row()], customerActive: true });
    const r = await sweepWebApp(d);
    expect(r.stillActive).toEqual(['s1']);
    expect(d.markTakenDown).not.toHaveBeenCalled();
    expect(d.deployOffline).not.toHaveBeenCalled();
  });

  it('stamps every visited row, skipped ones included, so the oldest-checked order rotates', async () => {
    const d = fakes({ up: [row({ slug: 'a' }), row({ slug: 'b', user_id: 'u2' })], ios: ['a'], entitled: ['u2'] });
    await sweepWebApp(d);
    expect((d.stampChecked as any).mock.calls.map((c: any[]) => c[0]).sort()).toEqual(['a', 'b']);
  });
});

describe('sweepIosOverlap (alert only)', () => {
  const orow = (id = 'sub_1', uid: string | null = 'u1'): OverlapRow => ({ stripe_subscription_id: id, stripe_customer_id: 'cus_1', user_id: uid, tier: 'website', site_slug: 'fresh' });
  function ofakes(o: { rows?: OverlapRow[]; state?: any; lookupErr?: boolean; mailErr?: boolean; noEmail?: boolean; ownerErr?: boolean } = {}) {
    const claimed = new Set<string>();
    const deps: IosOverlapDeps = {
      candidates: vi.fn(async () => (o.rows ?? [orow()]).filter((r) => !claimed.has(r.stripe_subscription_id))),
      stampChecked: vi.fn(async () => {}),
      appStoreState: vi.fn(async () => { if (o.lookupErr) throw new Error('supabase 500'); return o.state === undefined ? 'active' : o.state; }),
      claim: vi.fn(async (id) => { if (claimed.has(id)) return false; claimed.add(id); return true; }),
      release: vi.fn(async (id) => { claimed.delete(id); }),
      mailCustomer: vi.fn(async () => { if (o.mailErr) throw new Error('resend 500'); return !o.noEmail; }),
      mailOwner: vi.fn(async () => { if (o.ownerErr) throw new Error('owner mail down'); }),
    };
    return deps;
  }
  it('an overlap is emailed once (customer and owner), a second run sends nothing', async () => {
    const d = ofakes();
    expect((await sweepIosOverlap(d)).notified).toEqual(['sub_1']);
    expect(d.mailCustomer).toHaveBeenCalledTimes(1); expect(d.mailOwner).toHaveBeenCalledTimes(1);
    expect((await sweepIosOverlap(d)).notified).toEqual([]);
    expect(d.mailCustomer).toHaveBeenCalledTimes(1);
  });
  it('no App Store state (for example a Sandbox purchase under a live key): nothing is claimed or sent, but the row is stamped', async () => {
    const d = ofakes({ state: null });
    await sweepIosOverlap(d);
    expect(d.stampChecked).toHaveBeenCalledWith('sub_1');
    expect(d.claim).not.toHaveBeenCalled(); expect(d.mailCustomer).not.toHaveBeenCalled();
  });
  it('S3a: a lapsed iOS plan (linked) never emails the customer; only the owner', async () => {
    const d = ofakes({ state: 'linked' });
    const r = await sweepIosOverlap(d);
    expect(d.mailCustomer).not.toHaveBeenCalled();
    expect(d.mailOwner).toHaveBeenCalledTimes(1);
    expect(r.ownerOnly).toEqual(['sub_1']);
  });
  it('S3b: a failed OWNER mail never re-emails the customer on the next run', async () => {
    const d = ofakes({ ownerErr: true });
    await sweepIosOverlap(d); await sweepIosOverlap(d);
    expect(d.mailCustomer).toHaveBeenCalledTimes(1);
    expect(d.release).not.toHaveBeenCalled();
  });
  it('a failed CUSTOMER mail releases the claim so the next run retries, and the owner is not alerted yet', async () => {
    const d = ofakes({ mailErr: true });
    const r = await sweepIosOverlap(d);
    expect(r.mailFailed).toEqual(['sub_1']);
    expect(d.release).toHaveBeenCalledWith('sub_1');
    expect(d.mailOwner).not.toHaveBeenCalled();
  });
  it('S3c: a customer with no email is stamped (claim kept) and the owner is told', async () => {
    const d = ofakes({ noEmail: true });
    const r = await sweepIosOverlap(d);
    expect(r.noEmail).toEqual(['sub_1']);
    expect(d.release).not.toHaveBeenCalled();
    expect((d.mailOwner as any).mock.calls[0][2]).toMatch(/NO email/);
    await sweepIosOverlap(d);
    expect(d.mailOwner).toHaveBeenCalledTimes(1);
  });
  it('S3d: every visited row is stamped checked so later rows are reached', async () => {
    const d = ofakes({ rows: [orow('a'), orow('b', 'u2')], state: null });
    await sweepIosOverlap(d);
    expect(d.stampChecked).toHaveBeenCalledTimes(2);
  });
  it('a row with no user_id is stamped checked (so it cannot sit at the head of the queue) and otherwise skipped', async () => {
    const d = ofakes({ rows: [orow('nouser', null)] });
    await sweepIosOverlap(d);
    expect(d.stampChecked).toHaveBeenCalledWith('nouser');
    expect(d.appStoreState).not.toHaveBeenCalled(); expect(d.claim).not.toHaveBeenCalled();
  });
  it('a lookup error skips that user without throwing the sweep', async () => {
    const d = ofakes({ lookupErr: true, rows: [orow('sub_1'), orow('sub_2', 'u2')] });
    const r = await sweepIosOverlap(d);
    expect(r.lookupFailed).toBe(2); expect(r.notified).toEqual([]);
  });
});
