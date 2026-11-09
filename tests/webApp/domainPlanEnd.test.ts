import { describe, it, expect, vi } from 'vitest';
import { fakeDomainsRepo, blankRow } from '../ios/fakeDomainsRepo.js';
import { onPlanEnded, onPlanResumed, planEndedEmail, OFF_BY_CUSTOMER, OFF_PLAN_ENDED, PLAN_ENDED_MAIL } from '../../lib/webApp/domainPlanEnd.js';
import { webDomainRenewal } from '../../lib/webDomains.js';
import { webStatusBody } from '../../lib/webApp/domainManual.js';
import { sweepDomainRenewal } from '../../lib/webApp/domainPlanEnd.js';
import { sweepWebApp } from '../../lib/webApp/lapse.js';

const NOW = Date.parse('2026-11-08T00:00:00Z');
const END = Math.floor(Date.parse('2027-03-01T00:00:00Z') / 1000);

function setup(over: { row?: any; sub?: any; set?: any; mode?: 'live' | 'test'; extra?: any[] } = {}) {
  const repo = fakeDomainsRepo([
    blankRow({ original_transaction_id: 'stripe:sub_dom', source: 'stripe', site_slug: 'fresh-cuts', domain: 'freshcuts.com', state: 'live', environment: 'Production', auto_renew: true, ...over.row }),
    ...(over.extra ?? []),
  ]);
  let sub = over.sub === undefined ? { customer: 'cus_1', status: 'active', current_period_end: END, cancel_at_period_end: false } : over.sub;
  const setRenewal = vi.fn(over.set ?? (async (_id: string, cancel: boolean) => { if (sub) sub = { ...sub, cancel_at_period_end: cancel }; return { ok: true, status: 200, data: {} }; }));
  const sendMail = vi.fn(async (_to: string, _mail: any, _key: string) => 'sent');
  const deps = { repo, mode: over.mode ?? 'live', getSubscription: vi.fn(async () => sub), setRenewal, contactEmail: vi.fn(async () => 'owner@example.test'), sendMail, now: () => NOW } as any;
  return { repo, deps, setRenewal, sendMail, row: () => repo.rows.get('stripe:sub_dom')! };
}

describe('plan ended', () => {
  it('sets cancel_at_period_end=true on the domain sub, then one plain letter; a retry sends nothing more', async () => {
    const t = setup();
    await onPlanEnded('fresh-cuts', 'u1', t.deps);
    expect(t.setRenewal).toHaveBeenCalledWith('sub_dom', true, expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect((t.sendMail.mock.calls[0] as any[])[2]).toBe(`plan-ended-sub_dom-${t.row().alerts_sent![OFF_PLAN_ENDED]}`);
    expect(t.sendMail).toHaveBeenCalledTimes(1);
    const mail = (t.sendMail.mock.calls[0] as any[])[1];
    expect(mail.subject).toBe("freshcuts.com won't renew");
    expect(mail.text).toBe("Your Prime Barber plan has ended, so freshcuts.com won't renew on 2027-03-01. If you come back before then, it renews again and you keep the same address.\n\nPrime Barber");
    expect(mail.text).not.toMatch(/\$|https?:/);
    expect(t.row().alerts_sent).toMatchObject({ [OFF_PLAN_ENDED]: expect.any(String), [PLAN_ENDED_MAIL]: expect.any(String) });
    expect(t.row().auto_renew).toBe(false);
    await onPlanEnded('fresh-cuts', 'u1', t.deps);
    expect(t.sendMail).toHaveBeenCalledTimes(1);
    expect(t.setRenewal).toHaveBeenCalledTimes(1);
  });

  it('a mail that failed is retried on the next call without a second Stripe write (the claim is released)', async () => {
    const t = setup();
    t.sendMail.mockRejectedValueOnce(new Error('smtp'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await onPlanEnded('fresh-cuts', 'u1', t.deps);
    await onPlanEnded('fresh-cuts', 'u1', t.deps);
    log.mockRestore();
    expect(t.sendMail).toHaveBeenCalledTimes(2);
    expect(t.setRenewal).toHaveBeenCalledTimes(1);
  });

  it('refunded, ended (failed/detached) and other-mode rows are ignored', async () => {
    for (const row of [{ state: 'failed', refunded_at: '2026-11-01T00:00:00Z' }, { state: 'detached' }, { state: 'transferred' }, { environment: 'Sandbox' }]) {
      const t = setup({ row });
      await onPlanEnded('fresh-cuts', 'u1', t.deps);
      expect(t.setRenewal).not.toHaveBeenCalled();
      expect(t.sendMail).not.toHaveBeenCalled();
    }
  });

  it('a sub unknown to this key (other mode), cancelled, or past its period is left alone', async () => {
    for (const sub of [null, { customer: 'c', status: 'canceled', current_period_end: END }, { customer: 'c', status: 'active', current_period_end: Math.floor(NOW / 1000) - 5 }]) {
      const t = setup({ sub });
      await onPlanEnded('fresh-cuts', 'u1', t.deps);
      expect(t.setRenewal).not.toHaveBeenCalled();
    }
  });

  it('a domain the customer already turned off is left as theirs: no write, no mail', async () => {
    const t = setup({ sub: { customer: 'c', status: 'active', current_period_end: END, cancel_at_period_end: true }, row: { alerts_sent: { [OFF_BY_CUSTOMER]: 'x' } } });
    await onPlanEnded('fresh-cuts', 'u1', t.deps);
    expect(t.setRenewal).not.toHaveBeenCalled();
    expect(t.sendMail).not.toHaveBeenCalled();
  });

  it('other sites and iOS (apple) rows are untouched', async () => {
    const t = setup({ extra: [
      blankRow({ original_transaction_id: 'apple:1', source: 'apple', site_slug: 'fresh-cuts-ios', domain: 'ios.com', state: 'live' }),
      blankRow({ original_transaction_id: 'stripe:sub_other', source: 'stripe', site_slug: 'other', domain: 'other.com', state: 'live' }),
    ] });
    t.deps.getSubscription.mockImplementation(async () => ({ customer: 'c', status: 'active', current_period_end: END }));
    await onPlanEnded('fresh-cuts', 'u1', t.deps);
    expect(t.setRenewal).toHaveBeenCalledTimes(1);
    expect(t.setRenewal.mock.calls[0][0]).toBe('sub_dom');
  });

  it('a Stripe error is logged with its code and nothing throws; no mail', async () => {
    const t = setup({ set: async () => ({ ok: false, status: 400, data: { error: { code: 'resource_missing' } } }) });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(onPlanEnded('fresh-cuts', 'u1', t.deps)).resolves.toBeUndefined();
    expect(log.mock.calls.join(' ')).toContain('resource_missing');
    log.mockRestore();
    expect(t.sendMail).not.toHaveBeenCalled();
  });

  it('the status body says why renewal is off', async () => {
    const t = setup();
    await onPlanEnded('fresh-cuts', 'u1', t.deps);
    expect(webStatusBody(t.row())).toMatchObject({ autoRenew: false, renewalOffReason: 'plan-ended' });
  });
});

describe('plan comes back', () => {
  it('before the date, renewal turns back on and the markers are cleared (a later end mails again)', async () => {
    const t = setup();
    await onPlanEnded('fresh-cuts', 'u1', t.deps);
    await onPlanResumed('fresh-cuts', t.deps);
    expect(t.setRenewal).toHaveBeenLastCalledWith('sub_dom', false, expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(t.row().auto_renew).toBe(true);
    expect(t.row().alerts_sent).toEqual({});
    await onPlanResumed('fresh-cuts', t.deps); // a retry: nothing more
    expect(t.setRenewal).toHaveBeenCalledTimes(2);
  });

  it('does NOT resume a domain the customer turned off themselves', async () => {
    const t = setup();
    await webDomainRenewal('cancel-renewal', { siteId: 'fresh-cuts' }, 'Bearer o', { authorize: async () => ({ ok: true, target: 'fresh-cuts' }), flow: { repo: t.repo }, getSubscription: t.deps.getSubscription, createPortalSession: vi.fn(), setRenewal: t.setRenewal } as any, () => NOW);
    expect(t.row().alerts_sent).toMatchObject({ [OFF_BY_CUSTOMER]: expect.any(String) });
    t.setRenewal.mockClear();
    await onPlanEnded('fresh-cuts', 'u1', t.deps); // plan ends later: already theirs
    await onPlanResumed('fresh-cuts', t.deps);
    expect(t.setRenewal).not.toHaveBeenCalled();
    expect(t.row().auto_renew).toBe(false);
  });

  it('a customer who turned it off, then the plan ended and came back: still not resumed', async () => {
    const t = setup({ row: { auto_renew: false, alerts_sent: { [OFF_BY_CUSTOMER]: 'x', [OFF_PLAN_ENDED]: 'y' } }, sub: { customer: 'c', status: 'active', current_period_end: END, cancel_at_period_end: true } });
    await onPlanResumed('fresh-cuts', t.deps);
    expect(t.setRenewal).not.toHaveBeenCalled();
  });

  it('after the paid period ended nothing is resumed', async () => {
    const t = setup({ row: { auto_renew: false, alerts_sent: { [OFF_PLAN_ENDED]: 'y' } }, sub: { customer: 'c', status: 'active', current_period_end: Math.floor(NOW / 1000) - 5, cancel_at_period_end: true } });
    await onPlanResumed('fresh-cuts', t.deps);
    expect(t.setRenewal).not.toHaveBeenCalled();
  });

  it('refunded and other-mode rows are ignored', async () => {
    for (const row of [{ state: 'failed', refunded_at: '2026-11-01T00:00:00Z', alerts_sent: { [OFF_PLAN_ENDED]: 'y' } }, { environment: 'Sandbox', alerts_sent: { [OFF_PLAN_ENDED]: 'y' } }]) {
      const t = setup({ row });
      await onPlanResumed('fresh-cuts', t.deps);
      expect(t.setRenewal).not.toHaveBeenCalled();
    }
  });
});

describe('round 3: safety', () => {
  it('Stripe replays a reused idempotency key: end, resume, end within a day still stops the renewal and mails twice (new letter, new period key)', async () => {
    const t = setup();
    const seen = new Set<string>();
    let cur: any = { customer: 'cus_1', status: 'active', current_period_end: END, cancel_at_period_end: false };
    t.deps.getSubscription = vi.fn(async () => cur);
    t.deps.setRenewal = vi.fn(async (_id: string, cancel: boolean, key: string) => { if (!seen.has(key)) { seen.add(key); cur = { ...cur, cancel_at_period_end: cancel }; } return { ok: true, status: 200, data: {} }; });
    await onPlanEnded('fresh-cuts', 'u1', t.deps);
    await onPlanResumed('fresh-cuts', t.deps);
    expect(cur.cancel_at_period_end).toBe(false);
    await onPlanEnded('fresh-cuts', 'u1', t.deps);
    expect(cur.cancel_at_period_end).toBe(true);
    expect(t.sendMail).toHaveBeenCalledTimes(2);
  });

  it('a write Stripe does not confirm marks nothing and mails nothing; the next pass retries', async () => {
    let ok = false;
    const t = setup();
    let cur: any = { customer: 'cus_1', status: 'active', current_period_end: END, cancel_at_period_end: false };
    t.deps.getSubscription = vi.fn(async () => cur);
    t.deps.setRenewal = vi.fn(async (_id: string, cancel: boolean) => { if (ok) cur = { ...cur, cancel_at_period_end: cancel }; return { ok: true, status: 200, data: {} }; });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await onPlanEnded('fresh-cuts', 'u1', t.deps);
    log.mockRestore();
    expect(t.sendMail).not.toHaveBeenCalled();
    expect(t.row().alerts_sent).not.toHaveProperty(PLAN_ENDED_MAIL); // no letter claimed; only the intent marker (L2) is kept
    ok = true;
    await onPlanEnded('fresh-cuts', 'u1', t.deps);
    expect(t.sendMail).toHaveBeenCalledTimes(1);
    expect(cur.cancel_at_period_end).toBe(true);
  });

  it('two passes at once (webhook + sweep) send one letter', async () => {
    const t = setup();
    await Promise.all([onPlanEnded('fresh-cuts', 'u1', t.deps), onPlanEnded('fresh-cuts', 'u1', t.deps)]);
    expect(t.sendMail).toHaveBeenCalledTimes(1);
  });

  it('a site an iOS purchase owns is left alone', async () => {
    const t = setup();
    t.deps.iosOwnsSlug = vi.fn(async () => true);
    await onPlanEnded('fresh-cuts', 'u1', t.deps);
    expect(t.setRenewal).not.toHaveBeenCalled();
    expect(t.sendMail).not.toHaveBeenCalled();
  });

  it('another entitled plan (a tier switch, checked at Stripe too) means nothing ends', async () => {
    const t = setup();
    t.deps.hasOtherPlan = vi.fn(async () => true);
    await onPlanEnded('fresh-cuts', 'u1', t.deps, { excludeSub: 'sub_plan', customerId: 'cus_1' });
    expect(t.deps.hasOtherPlan).toHaveBeenCalledWith('u1', 'sub_plan', 'cus_1');
    expect(t.setRenewal).not.toHaveBeenCalled();
    expect(t.sendMail).not.toHaveBeenCalled();
  });

  it('backstop: a taken-down site with no plan whose domain still renews gets the plan-end; a live or planned site does not', async () => {
    const mk = (site: any, entitled = false) => {
      const t = setup();
      return { t, deps: { ...t.deps, siteOf: async () => site, hasEntitledRow: async () => entitled, customerOf: async () => 'cus_web' } as any };
    };
    const down = mk({ user_id: 'u1', published_at: 'x', taken_down_at: 'y', removed_at: null });
    expect((await sweepDomainRenewal(down.deps)).ended).toEqual(['fresh-cuts']);
    expect(down.t.sendMail).toHaveBeenCalledTimes(1);
    expect((await sweepDomainRenewal(down.deps)).checked).toBe(0); // idempotent: spent rows are skipped
    expect(down.t.sendMail).toHaveBeenCalledTimes(1);
    for (const m of [mk({ user_id: 'u1', published_at: 'x', taken_down_at: null, removed_at: null }), mk({ user_id: 'u1', published_at: 'x', taken_down_at: 'y', removed_at: null }, true), mk(null)]) {
      await sweepDomainRenewal(m.deps);
      expect(m.t.setRenewal).not.toHaveBeenCalled();
    }
    const gone = mk({ user_id: 'u1', published_at: null, taken_down_at: null, removed_at: 'z' });
    expect((await sweepDomainRenewal(gone.deps)).ended).toEqual(['fresh-cuts']);
  });

  it('backstop retries a mail that failed after the renewal was already stopped', async () => {
    const t = setup();
    t.sendMail.mockRejectedValueOnce(new Error('smtp'));
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const deps: any = { ...t.deps, siteOf: async () => ({ user_id: 'u1', published_at: 'x', taken_down_at: 'y', removed_at: null }), hasEntitledRow: async () => false, customerOf: async () => 'cus_web' };
    await sweepDomainRenewal(deps);
    await sweepDomainRenewal(deps);
    log.mockRestore();
    expect(t.sendMail).toHaveBeenCalledTimes(2);
    expect(t.setRenewal).toHaveBeenCalledTimes(1);
  });
});

describe('round 4', () => {
  const DOWN = { user_id: 'u1', published_at: 'x', taken_down_at: 'y', removed_at: null };

  it('N1: the backstop passes the owner customer, so a resubscribe whose webhook is late (a plan only at Stripe) ends nothing and mails nothing', async () => {
    const t = setup();
    const hasOtherPlan = vi.fn(async (_u: any, _e: any, customer: any) => customer === 'cus_web'); // Stripe lists an active aibarber-app sub
    const deps: any = { ...t.deps, hasOtherPlan, siteOf: async () => DOWN, hasEntitledRow: async () => false, customerOf: async () => 'cus_web' };
    await sweepDomainRenewal(deps);
    expect(hasOtherPlan).toHaveBeenCalledWith('u1', undefined, 'cus_web');
    expect(t.setRenewal).not.toHaveBeenCalled();
    expect(t.sendMail).not.toHaveBeenCalled();
  });

  it('N1: no known customer means the row is skipped, not acted on', async () => {
    const t = setup();
    const deps: any = { ...t.deps, siteOf: async () => DOWN, hasEntitledRow: async () => false, customerOf: async () => null };
    expect((await sweepDomainRenewal(deps)).checked).toBe(0);
    expect(t.setRenewal).not.toHaveBeenCalled();
  });

  it('N2: more than 50 healthy / legacy rows ahead of a real candidate do not starve it; the cap counts only rows acted on', async () => {
    const legacy = Array.from({ length: 60 }, (_, i) => blankRow({ original_transaction_id: `stripe:sub_old${i}`, source: 'stripe', site_slug: `old${i}`, domain: `old${i}.com`, state: 'live', environment: 'Production', created_at: '2020-01-01T00:00:00.000Z' }));
    const t = setup({ extra: legacy });
    const deps: any = { ...t.deps, siteOf: async (slug: string) => (slug === 'fresh-cuts' ? DOWN : null), hasEntitledRow: async () => false, customerOf: async () => 'cus_web' };
    expect((await sweepDomainRenewal(deps)).ended).toEqual(['fresh-cuts']);
  });

  it('N2: the limit stops after that many rows acted on', async () => {
    const many = Array.from({ length: 5 }, (_, i) => blankRow({ original_transaction_id: `stripe:sub_m${i}`, source: 'stripe', site_slug: `m${i}`, domain: `m${i}.com`, state: 'live', environment: 'Production' }));
    const t = setup({ extra: many });
    t.deps.getSubscription = vi.fn(async () => ({ customer: 'c', status: 'active', current_period_end: END, cancel_at_period_end: false }));
    const deps: any = { ...t.deps, siteOf: async () => DOWN, hasEntitledRow: async () => false, customerOf: async () => 'cus_web' };
    expect((await sweepDomainRenewal(deps, 2)).checked).toBe(2);
  });

  it('L1: a second plan-end after a resume sends with a NEW Resend key (a replaying Resend would drop a repeat)', async () => {
    const t = setup();
    await onPlanEnded('fresh-cuts', 'u1', t.deps);
    await onPlanResumed('fresh-cuts', t.deps);
    t.deps.now = () => NOW + 3_600_000;
    await onPlanEnded('fresh-cuts', 'u1', t.deps);
    const keys = t.sendMail.mock.calls.map((c) => c[2]);
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(2);
  });

  it('L2: the marker is stored BEFORE the Stripe write; a failed write keeps it, a later pass retries, and resume still clears it', async () => {
    const t = setup();
    let markerAtWrite: any = 'unset';
    let fail = true;
    let cur: any = { customer: 'cus_1', status: 'active', current_period_end: END, cancel_at_period_end: false };
    t.deps.getSubscription = vi.fn(async () => cur);
    t.deps.setRenewal = vi.fn(async (_id: string, cancel: boolean) => {
      markerAtWrite = t.row().alerts_sent?.[OFF_PLAN_ENDED];
      if (fail) return { ok: false, status: 500, data: { error: { code: 'api_error' } } };
      cur = { ...cur, cancel_at_period_end: cancel };
      return { ok: true, status: 200, data: {} };
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    await onPlanEnded('fresh-cuts', 'u1', t.deps);
    log.mockRestore();
    expect(markerAtWrite).toEqual(expect.any(String));
    expect(t.row().alerts_sent![OFF_PLAN_ENDED]).toBe(markerAtWrite); // kept
    expect(t.sendMail).not.toHaveBeenCalled();
    // resume while Stripe still renews: the spent marker is cleared, nothing is written
    await onPlanResumed('fresh-cuts', t.deps);
    expect(t.row().alerts_sent).toEqual({});
    expect(t.deps.setRenewal).toHaveBeenCalledTimes(1);
    // a later plan-end retries and completes
    fail = false;
    await onPlanEnded('fresh-cuts', 'u1', t.deps);
    expect(cur.cancel_at_period_end).toBe(true);
    expect(t.sendMail).toHaveBeenCalledTimes(1);
  });
});

describe('lapse path', () => {
  it('a takedown also ends the domain renewal; a planEnded failure never fails the sweep', async () => {
    const row = { slug: 'fresh-cuts', stripe_subscription_id: 'sub_plan', user_id: 'u1', environment: 'live', published_at: 'x', taken_down_at: null, removed_at: null } as any;
    const planEnded = vi.fn(async () => { throw new Error('boom'); });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await sweepWebApp({
      takedownCandidates: async () => [row], restoreCandidates: async () => [], iosOwnsSlug: async () => false, hasEntitledRow: async () => false,
      subscriptionStatus: async () => 'canceled', customerHasActive: async () => false, stampChecked: async () => {}, markTakenDown: async () => {},
      clearTakenDown: async () => {}, deployOffline: async () => {}, publish: async () => ({ ok: true } as any), planEnded, now: () => NOW,
    });
    log.mockRestore();
    expect(planEnded).toHaveBeenCalledWith(row);
    expect(out.takenDown).toEqual(['fresh-cuts']);
  });

  it('the restore pass resumes the domain renewal under the same rules (and a resume failure never fails the sweep)', async () => {
    const row = { slug: 'fresh-cuts', stripe_subscription_id: 'sub_plan', user_id: 'u1', environment: 'live', published_at: 'x', taken_down_at: 'y', removed_at: null } as any;
    const planResumed = vi.fn(async () => { throw new Error('boom'); });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const out = await sweepWebApp({
      takedownCandidates: async () => [], restoreCandidates: async () => [row], iosOwnsSlug: async () => false, hasEntitledRow: async () => true,
      subscriptionStatus: async () => 'active', customerHasActive: async () => true, stampChecked: async () => {}, markTakenDown: async () => {},
      clearTakenDown: async () => {}, deployOffline: async () => {}, publish: async () => ({ ok: true } as any), planResumed, now: () => NOW,
    });
    log.mockRestore();
    expect(planResumed).toHaveBeenCalledWith(row);
    expect(out.restored).toEqual(['fresh-cuts']);
  });
});

it('planEndedEmail has no price and at most one link', () => {
  const m = planEndedEmail({ domain: 'a.com', renewsOn: '2027-01-01' });
  expect(m.subject).toBe("a.com won't renew");
  expect(m.text).not.toMatch(/\$/);
  expect((m.text.match(/https?:\/\//g) ?? []).length).toBeLessThanOrEqual(1);
});
