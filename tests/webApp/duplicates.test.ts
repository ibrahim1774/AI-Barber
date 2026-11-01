import { describe, it, expect, vi } from 'vitest';
import { pickKeeper, classify, handleDuplicates, sweepDuplicates, type DupDeps, type DupSub } from '../../lib/webApp/duplicates.js';

const NOW = Date.parse('2026-11-01T00:00:00Z');
const sec = (ms: number) => Math.floor(ms / 1000);
const sub = (id: string, over: Partial<DupSub> = {}): DupSub => ({ id, customer: 'cus_1', created: sec(NOW - 86400_000), status: 'active', tier: 'website', amount: 1999, cancelAtPeriodEnd: false, ...over });

function fakes(o: { subs?: DupSub[]; refund?: boolean; claim?: boolean; invoices?: { paidInvoices: number; paymentIntent: string | null } | null; cancelErr?: boolean; refundErr?: boolean; alertErr?: boolean } = {}) {
  const log: string[] = [];
  const deps: DupDeps = {
    refundEnabled: () => !!o.refund,
    entitledSubs: vi.fn(async () => o.subs ?? []),
    invoiceInfo: vi.fn(async () => (o.invoices === undefined ? { paidInvoices: 1, paymentIntent: 'pi_1' } : o.invoices)),
    claim: vi.fn(async () => o.claim !== false),
    releaseClaim: vi.fn(async () => {}),
    cancel: vi.fn(async (id) => { log.push(`cancel:${id}`); if (o.cancelErr) throw new Error('cancel boom'); }),
    refund: vi.fn(async (id, pi) => { log.push(`refund:${id}:${pi}`); if (o.refundErr) throw new Error('refund boom'); }),
    stampRefunded: vi.fn(async () => {}),
    alert: vi.fn(async (s) => { log.push(`alert:${s}`); if (o.alertErr) throw new Error('mail down'); }),
    mailCustomer: vi.fn(async () => {}),
    now: () => NOW,
  };
  return { deps, log };
}
const two = () => [sub('sub_b', { created: sec(NOW - 3600_000) }), sub('sub_a', { created: sec(NOW - 5 * 86400_000) })];

describe('pickKeeper', () => {
  it('oldest created wins, id breaks a tie, input order does not matter', () => {
    const a = sub('sub_a', { created: 100 }); const b = sub('sub_b', { created: 200 });
    expect(pickKeeper([b, a]).id).toBe('sub_a');
    expect(pickKeeper([a, b]).id).toBe('sub_a');
    const x = sub('sub_x', { created: 5 }); const y = sub('sub_y', { created: 5 });
    expect(pickKeeper([y, x]).id).toBe('sub_x');
    expect(pickKeeper([x, y]).id).toBe('sub_x');
  });
});

describe('classify', () => {
  const keeper = sub('k', { created: sec(NOW - 9 * 86400_000) });
  const inv = { paidInvoices: 1, paymentIntent: 'pi' };
  it('refundable: young, one paid invoice, keeper not cancelling', () => {
    expect(classify(keeper, sub('d'), inv, NOW)).toBe('refundable');
  });
  it('alert only: older than 7 days, 0 or 2 paid invoices, no payment intent, keeper cancelling, or unknown invoices', () => {
    expect(classify(keeper, sub('d', { created: sec(NOW - 8 * 86400_000) }), inv, NOW)).toBe('alert_only');
    expect(classify(keeper, sub('d'), { paidInvoices: 0, paymentIntent: null }, NOW)).toBe('alert_only');
    expect(classify(keeper, sub('d'), { paidInvoices: 2, paymentIntent: 'pi' }, NOW)).toBe('alert_only');
    expect(classify(keeper, sub('d'), { paidInvoices: 1, paymentIntent: null }, NOW)).toBe('alert_only');
    expect(classify({ ...keeper, cancelAtPeriodEnd: true }, sub('d'), inv, NOW)).toBe('alert_only');
    expect(classify(keeper, sub('d'), null, NOW)).toBe('alert_only');
  });
});

describe('handleDuplicates', () => {
  it('one entitled subscription: nothing happens', async () => {
    const { deps } = fakes({ subs: [sub('sub_a')], refund: true });
    expect(await handleDuplicates('u1', deps)).toMatchObject({ found: 0, alerted: 0 });
    expect(deps.claim).not.toHaveBeenCalled(); expect(deps.alert).not.toHaveBeenCalled();
  });

  it('two entitled subscriptions, refund flag off: one alert, no Stripe write at all', async () => {
    const { deps } = fakes({ subs: two() });
    const r = await handleDuplicates('u1', deps);
    expect(r).toMatchObject({ found: 1, alerted: 1, refunded: 0 });
    expect(deps.claim).toHaveBeenCalledWith('sub_b', 'sub_a');
    expect(deps.alert).toHaveBeenCalledTimes(1);
    expect(deps.invoiceInfo).not.toHaveBeenCalled();
    expect(deps.cancel).not.toHaveBeenCalled(); expect(deps.refund).not.toHaveBeenCalled(); expect(deps.mailCustomer).not.toHaveBeenCalled();
  });

  it('refund flag on and refundable: alert, then cancel, then refund, stamped, customer mailed; keeper untouched', async () => {
    const { deps, log } = fakes({ subs: two(), refund: true });
    const r = await handleDuplicates('u1', deps);
    expect(r.refunded).toBe(1);
    expect(log).toEqual(['alert:AI Barber web: customer is paying twice', 'cancel:sub_b', 'refund:sub_b:pi_1']);
    expect(deps.stampRefunded).toHaveBeenCalledWith('sub_b');
    expect(deps.mailCustomer).toHaveBeenCalledWith('u1', 'cus_1', 'website');
    expect(deps.cancel).not.toHaveBeenCalledWith('sub_a');
  });

  it('the keeper is cancelling at period end: alert only even with the flag on', async () => {
    const s = two(); s[1].cancelAtPeriodEnd = true;
    const { deps } = fakes({ subs: s, refund: true });
    const r = await handleDuplicates('u1', deps);
    expect(r).toMatchObject({ alerted: 1, refunded: 0 });
    expect(deps.cancel).not.toHaveBeenCalled(); expect(deps.refund).not.toHaveBeenCalled();
  });

  it('a cancel failure causes no refund and the alert names a manual action', async () => {
    const { deps, log } = fakes({ subs: two(), refund: true, cancelErr: true });
    const r = await handleDuplicates('u1', deps);
    expect(r.refunded).toBe(0);
    expect(deps.refund).not.toHaveBeenCalled();
    expect(log.some((l) => l.startsWith('alert:AI Barber web: duplicate NOT cancelled'))).toBe(true);
    expect((deps.alert as any).mock.calls.at(-1)[1].join('\n')).toMatch(/manually/);
  });

  it('a refund failure after a successful cancel: the alert says refund manually, nothing stamped', async () => {
    const { deps } = fakes({ subs: two(), refund: true, refundErr: true });
    const r = await handleDuplicates('u1', deps);
    expect(r.refunded).toBe(0);
    expect(deps.cancel).toHaveBeenCalled();
    expect((deps.alert as any).mock.calls.at(-1)[0]).toMatch(/refund manually/);
    expect(deps.stampRefunded).not.toHaveBeenCalled(); expect(deps.mailCustomer).not.toHaveBeenCalled();
  });

  it('a claim lost to a concurrent runner: no email, no Stripe call', async () => {
    const { deps } = fakes({ subs: two(), refund: true, claim: false });
    const r = await handleDuplicates('u1', deps);
    expect(r.alerted).toBe(0);
    expect(deps.alert).not.toHaveBeenCalled(); expect(deps.invoiceInfo).not.toHaveBeenCalled(); expect(deps.cancel).not.toHaveBeenCalled();
  });

  it('when the owner alert cannot be sent the claim is released and no money moves', async () => {
    const { deps } = fakes({ subs: two(), refund: true, alertErr: true });
    const r = await handleDuplicates('u1', deps);
    expect(r).toMatchObject({ alerted: 0, errors: 1 });
    expect(deps.releaseClaim).toHaveBeenCalledWith('sub_b');
    expect(deps.cancel).not.toHaveBeenCalled();
  });

  it('three subscriptions: both newer ones are duplicates of the oldest', async () => {
    const { deps } = fakes({ subs: [...two(), sub('sub_c', { created: sec(NOW - 60_000) })] });
    expect((await handleDuplicates('u1', deps)).found).toBe(2);
  });
});

describe('sweepDuplicates (cron grouping)', () => {
  it('finds a duplicate whose webhooks raced and ignores users with one subscription', async () => {
    const { deps } = fakes({ subs: two() });
    const r = await sweepDuplicates('test', deps, async () => [
      { user_id: 'u1', stripe_subscription_id: 'sub_a' }, { user_id: 'u1', stripe_subscription_id: 'sub_b' },
      { user_id: 'u2', stripe_subscription_id: 'sub_z' }, { user_id: null, stripe_subscription_id: 'sub_n' },
    ]);
    expect(deps.entitledSubs).toHaveBeenCalledTimes(1);
    expect(deps.entitledSubs).toHaveBeenCalledWith('u1');
    expect(r).toMatchObject({ found: 1, alerted: 1 });
  });
  it('one user throwing does not stop the others', async () => {
    const { deps } = fakes({ subs: two() });
    (deps.entitledSubs as any).mockRejectedValueOnce(new Error('stripe down'));
    const r = await sweepDuplicates('test', deps, async () => [
      { user_id: 'u1', stripe_subscription_id: 'a' }, { user_id: 'u1', stripe_subscription_id: 'b' },
      { user_id: 'u2', stripe_subscription_id: 'c' }, { user_id: 'u2', stripe_subscription_id: 'd' },
    ]);
    expect(r.errors).toBe(1); expect(r.alerted).toBe(1);
  });
});
