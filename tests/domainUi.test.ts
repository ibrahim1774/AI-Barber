import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  DOMAIN_DISCLOSURE, DOMAIN_PRICE_LABEL, clearDomainCheckout, comDomainFrom, domainSiteId, panelView,
  rememberDomainCheckout, takeDomainCheckout, STEP_LABEL,
} from '../services/domainUi';
import { domainPortalForm, webDomainPanelStatus, webDomainPortal, webDomainRenewal } from '../lib/webDomains';
import { fakeDomainsRepo, blankRow } from './ios/fakeDomainsRepo';

const src = fs.readFileSync(path.join(process.cwd(), 'components/DomainManager.tsx'), 'utf8');
const app = fs.readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');

describe('manual fulfilment state in the legacy panel', () => {
  it('awaiting-setup shows the by-hand message as the only step; no offer', () => {
    expect(panelView({ domain: 'freshcuts.com', state: 'awaiting-setup' })).toEqual({ kind: 'progress', step: 'awaiting', domain: 'freshcuts.com' });
    expect(src).toMatch(/view\.step === 'awaiting'/);
    expect(STEP_LABEL.awaiting).toMatch(/by hand, usually within 1 business day, up to 3 business days/);
  });
});

describe('DomainManager (source checks)', () => {
  it('shows $39/year and the exact disclosure; never a monthly equivalent', () => {
    expect(DOMAIN_PRICE_LABEL).toBe('$39/year');
    expect(DOMAIN_DISCLOSURE).toBe("Registered by Prime Barber for your site. If you ever leave, contact support@davoxa.com and we'll transfer it to you.");
    expect(src).toMatch(/DOMAIN_PRICE_LABEL/);
    expect(src).toMatch(/DOMAIN_DISCLOSURE/);
    expect(src + fs.readFileSync(path.join(process.cwd(), 'services/domainUi.ts'), 'utf8')).not.toMatch(/\/mo\b|per month|a month|monthly|\$3\.25/i);
    expect(src).not.toMatch(/\$30/);
  });

  it('every call is owner-only (bearer) to the new endpoints; .com only; Cancel via the portal', () => {
    expect(src).toMatch(/Authorization: `Bearer \$\{token\}`/);
    for (const p of ['/api/create-domain-checkout', '/api/purchase-domain', '/api/web-domain']) expect(src).toContain(p);
    expect(src).toMatch(/comDomainFrom/);
    expect(src).toMatch(/Cancel domain/);
    expect(src).toMatch(/action: 'portal'/);
    expect(src).toMatch(/DOMAIN_CANCEL_NOTE/);
  });

  it('progress steps and the refunded message are shown', () => {
    expect(src).toMatch(/registering', 'linking', 'pointing'/);
    expect(src).toMatch(/view\.kind === 'refunded'/);
  });

  it('the success return remembers the session for the panel', () => {
    expect(app).toMatch(/rememberDomainCheckout\(params\.get\('session_id'\)\)/);
  });
});

describe('domainUi helpers', () => {
  beforeEach(() => clearDomainCheckout());

  it('.com only', () => {
    expect(comDomainFrom('Fresh Cuts')).toBe('freshcuts.com');
    expect(comDomainFrom('freshcuts.com')).toBe('freshcuts.com');
    expect(comDomainFrom('https://www.FreshCuts.com/')).toBe('freshcuts.com');
    expect(comDomainFrom('freshcuts.net')).toBeNull();
    expect(comDomainFrom('ab')).toBeNull();
  });

  it('site id: the vercel.app label, else the shop-name slug', () => {
    expect(domainSiteId({ deployedUrl: 'https://fresh-cuts-x1.vercel.app', data: { shopName: 'Fresh Cuts' } })).toBe('fresh-cuts-x1');
    expect(domainSiteId({ deployedUrl: null, data: { shopName: "Joe's Fresh Cuts" } })).toBe('joes-fresh-cuts');
  });

  it('the pending checkout is a validated session id, taken once', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
    rememberDomainCheckout('javascript:alert(1)');
    expect(takeDomainCheckout()).toBeNull();
    rememberDomainCheckout('cs_live_abcdefghij');
    expect(takeDomainCheckout()).toBe('cs_live_abcdefghij');
    clearDomainCheckout();
    expect(takeDomainCheckout()).toBeNull();
    vi.unstubAllGlobals();
  });

  it.each([
    [{ state: 'none', domain: null }, { kind: 'none' }],
    [{ state: 'registering', domain: 'a.com' }, { kind: 'progress', step: 'registering' }],
    [{ state: 'linking', domain: 'a.com' }, { kind: 'progress', step: 'linking' }],
    [{ state: 'live', domain: 'a.com', vercel: { dnsOk: false, ssl: 'pending' } }, { kind: 'progress', step: 'pointing' }],
    [{ state: 'live', domain: 'a.com', vercel: { dnsOk: true, ssl: 'ready' } }, { kind: 'live', cancelledUntil: null }],
    [{ state: 'cancelled-until:2027-10-22T00:00:00.000Z', domain: 'a.com' }, { kind: 'live', cancelledUntil: '2027-10-22T00:00:00.000Z' }],
    [{ state: 'failed:taken', domain: 'a.com', refunded: true, message: 'm' }, { kind: 'refunded', message: 'm' }],
    [{ state: 'failed:registrar', domain: 'a.com' }, { kind: 'failed', reason: 'registrar' }],
    [{ state: 'expired', domain: 'a.com' }, { kind: 'expired' }],
  ])('panelView(%j)', (b, want) => expect(panelView(b)).toMatchObject(want));
});

describe('api/web-domain (owner only)', () => {
  const authorize = vi.fn(async (siteId: unknown, auth: unknown) =>
    auth === 'Bearer owner' && siteId === 'fresh-cuts' ? { ok: true, target: 'fresh-cuts' } : { ok: false, status: 403 as const, error: 'not-authorized' });
  const setup = () => {
    const repo = fakeDomainsRepo();
    repo.rows.set('stripe:sub_1', blankRow({ original_transaction_id: 'stripe:sub_1', source: 'stripe', site_slug: 'fresh-cuts', domain: 'freshcuts.com', state: 'live', auto_renew: true }));
    const createPortalSession = vi.fn(async () => ({ ok: true, data: { url: 'https://billing.stripe.com/p' } }));
    return { repo, createPortalSession, deps: { authorize, flow: { repo }, getSubscription: vi.fn(async () => ({ customer: 'cus_1' })), createPortalSession } };
  };

  it('status: the owner sees the domain; anyone else 403', async () => {
    const { deps } = setup();
    expect(await webDomainPanelStatus({ siteId: 'fresh-cuts' }, 'Bearer owner', deps)).toMatchObject({ status: 200, body: { domain: 'freshcuts.com', state: 'live' } });
    expect((await webDomainPanelStatus({ siteId: 'fresh-cuts' }, 'Bearer x', deps)).status).toBe(403);
    expect((await webDomainPanelStatus({ siteId: 'other' }, 'Bearer owner', deps)).status).toBe(403);
  });

  it('a refunded row says refunded', async () => {
    const { deps, repo } = setup();
    repo.rows.set('stripe:sub_1', { ...repo.rows.get('stripe:sub_1')!, state: 'failed', failure_reason: 'taken', refunded_at: new Date().toISOString() });
    expect(await webDomainPanelStatus({ siteId: 'fresh-cuts' }, 'Bearer owner', deps)).toMatchObject({ body: { refunded: true, paidUntil: null, autoRenew: false, canRetry: false } });
  });

  it("portal: the owner gets the portal of THIS domain subscription's customer; strangers 403", async () => {
    const { deps, createPortalSession } = setup();
    expect(await webDomainPortal({ siteId: 'fresh-cuts' }, 'Bearer owner', 'https://www.aibarber.org', deps)).toEqual({ status: 200, body: { url: 'https://billing.stripe.com/p' } });
    expect(createPortalSession).toHaveBeenCalledWith('cus_1', 'https://www.aibarber.org', 'sub_1');
    expect((await webDomainPortal({ siteId: 'fresh-cuts' }, 'Bearer x', 'o', deps)).status).toBe(403);
  });

  it('portal: no domain subscription id means an error, never the general portal', async () => {
    const { deps, repo, createPortalSession } = setup();
    repo.rows.set('stripe:sub_1', { ...repo.rows.get('stripe:sub_1')!, original_transaction_id: 'stripe:' });
    expect((await webDomainPortal({ siteId: 'fresh-cuts' }, 'Bearer owner', 'o', deps)).status).toBe(404);
    expect(createPortalSession).not.toHaveBeenCalled();
  });

  it('portal form: cancel flow for the one domain subscription only, back to the domain screen', () => {
    const f = new URLSearchParams(domainPortalForm('cus_1', 'https://app.test/app/domain', 'sub_1'));
    expect(Object.fromEntries(f)).toEqual({
      customer: 'cus_1',
      return_url: 'https://app.test/app/domain',
      'flow_data[type]': 'subscription_cancel',
      'flow_data[subscription_cancel][subscription]': 'sub_1',
      'flow_data[after_completion][type]': 'redirect',
      'flow_data[after_completion][redirect][return_url]': 'https://app.test/app/domain',
    });
  });
});

describe('webDomainRenewal: server-side turn renewal off / on for the one domain subscription', () => {
  const NOW = Date.parse('2026-11-08T00:00:00Z');
  const future = Math.floor(Date.parse('2027-03-01T00:00:00Z') / 1000);
  const authorize = async (siteId: unknown, auth: unknown) =>
    auth === 'Bearer owner' && siteId === 'fresh-cuts' ? { ok: true, target: 'fresh-cuts' } : { ok: false, status: 403 as const, error: 'not-authorized' };
  const setup = (over: { sub?: any; row?: any; set?: any; plan?: boolean } = {}) => {
    const repo = fakeDomainsRepo();
    repo.rows.set('stripe:sub_1', blankRow({ original_transaction_id: 'stripe:sub_1', source: 'stripe', site_slug: 'fresh-cuts', domain: 'freshcuts.com', state: 'live', auto_renew: true, paid_until: '2027-03-01T00:00:00Z', ...over.row }));
    let cur = over.sub === undefined ? { customer: 'cus_1', status: 'active', current_period_end: future, cancel_at_period_end: !!over.row?.cancelAtEnd } : over.sub;
    const setRenewal = vi.fn(over.set ?? (async (_id: string, cancel: boolean) => { if (cur) cur = { ...cur, cancel_at_period_end: cancel }; return { ok: true, status: 200, data: {} }; }));
    const getSubscription = vi.fn(async () => cur);
    const hasActivePlan = vi.fn(async () => over.plan !== false);
    return { repo, setRenewal, getSubscription, hasActivePlan, deps: { authorize, flow: { repo }, getSubscription, createPortalSession: vi.fn(), setRenewal, hasActivePlan } as any };
  };

  it('cancel: sets cancel_at_period_end=true on the domain sub only, row auto_renew off, fresh status', async () => {
    const { deps, setRenewal, repo } = setup();
    const r = await webDomainRenewal('cancel-renewal', { siteId: 'fresh-cuts' }, 'Bearer owner', deps, () => NOW);
    expect(setRenewal).toHaveBeenCalledWith('sub_1', true, expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ domain: 'freshcuts.com', autoRenew: false });
    expect(String((r.body as any).state)).toMatch(/^cancelled-until:/);
    expect(repo.rows.get('stripe:sub_1')!.auto_renew).toBe(false);
  });

  it('resume: sets cancel_at_period_end=false and turns renewal back on', async () => {
    const { deps, setRenewal } = setup({ row: { auto_renew: false } });
    const r = await webDomainRenewal('resume-renewal', { siteId: 'fresh-cuts' }, 'Bearer owner', deps, () => NOW);
    expect(setRenewal).toHaveBeenCalledWith('sub_1', false, expect.stringMatching(/^[0-9a-f-]{36}$/));
    expect(r).toMatchObject({ status: 200, body: { state: 'live', autoRenew: true } });
  });

  it('a wrong owner is 403 and nothing is sent', async () => {
    const { deps, setRenewal } = setup();
    expect((await webDomainRenewal('cancel-renewal', { siteId: 'fresh-cuts' }, 'Bearer x', deps, () => NOW)).status).toBe(403);
    expect(setRenewal).not.toHaveBeenCalled();
  });

  it('a refunded row, an empty sub id and a sub from the other mode are 404', async () => {
    for (const o of [{ row: { state: 'failed', refunded_at: '2026-11-01T00:00:00Z' } }, { row: { original_transaction_id: 'stripe:' } }, { sub: null }]) {
      const { deps, setRenewal } = setup(o as any);
      expect((await webDomainRenewal('cancel-renewal', { siteId: 'fresh-cuts' }, 'Bearer owner', deps, () => NOW)).status).toBe(404);
      expect(setRenewal).not.toHaveBeenCalled();
    }
  });

  it('resume is 409 not-resumable when the sub is cancelled or past its period end', async () => {
    for (const sub of [{ customer: 'c', status: 'canceled', current_period_end: future }, { customer: 'c', status: 'active', current_period_end: Math.floor(NOW / 1000) - 10 }]) {
      const { deps, setRenewal } = setup({ sub });
      expect(await webDomainRenewal('resume-renewal', { siteId: 'fresh-cuts' }, 'Bearer owner', deps, () => NOW)).toEqual({ status: 409, body: { error: 'not-resumable' } });
      expect(setRenewal).not.toHaveBeenCalled();
    }
  });

  it('a Stripe error is 502, logs the code (no PII) and leaves the row alone', async () => {
    const { deps, repo } = setup({ set: async () => ({ ok: false, status: 400, data: { error: { code: 'resource_missing', message: 'secret@x.com' } } }) });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await webDomainRenewal('cancel-renewal', { siteId: 'fresh-cuts' }, 'Bearer owner', deps, () => NOW);
    expect(r).toEqual({ status: 502, body: { error: 'renewal-unavailable' } });
    expect(log.mock.calls.join(' ')).toContain('resource_missing');
    expect(log.mock.calls.join(' ')).not.toContain('secret@x.com');
    expect(repo.rows.get('stripe:sub_1')!.auto_renew).toBe(true);
    log.mockRestore();
  });

  it('every action gets its own idempotency key; off, on, off within one minute all take effect (a replaying Stripe)', async () => {
    const t = setup();
    const seen = new Map<string, boolean>();
    let cur: any = { customer: 'c', status: 'active', current_period_end: future, cancel_at_period_end: false };
    const set = vi.fn(async (_id: string, cancel: boolean, key: string) => {
      if (!seen.has(key)) { seen.set(key, cancel); cur = { ...cur, cancel_at_period_end: cancel }; } // a replayed key changes nothing
      return { ok: true, status: 200, data: {} };
    });
    const deps = { ...t.deps, setRenewal: set, getSubscription: async () => cur };
    for (const a of ['cancel-renewal', 'resume-renewal', 'cancel-renewal'] as const) {
      expect((await webDomainRenewal(a, { siteId: 'fresh-cuts' }, 'Bearer owner', deps, () => NOW)).status).toBe(200);
    }
    expect(new Set(set.mock.calls.map((c) => c[2])).size).toBe(3);
    expect(cur.cancel_at_period_end).toBe(true);
  });

  it('an unconfirmed Stripe write (replayed or ignored) is a 502 and records nothing', async () => {
    const t = setup({ set: async () => ({ ok: true, status: 200, data: {} }) }); // ok, but the sub never changes
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await webDomainRenewal('cancel-renewal', { siteId: 'fresh-cuts' }, 'Bearer owner', t.deps, () => NOW);
    log.mockRestore();
    expect(r).toEqual({ status: 502, body: { error: 'renewal-unavailable' } });
    expect(t.repo.rows.get('stripe:sub_1')!.alerts_sent).toBeNull();
    expect(t.repo.rows.get('stripe:sub_1')!.auto_renew).toBe(true);
  });

  it('resume needs an active hosting plan: 409 plan-required, nothing sent', async () => {
    const t = setup({ plan: false, row: { auto_renew: false } });
    expect(await webDomainRenewal('resume-renewal', { siteId: 'fresh-cuts' }, 'Bearer owner', t.deps, () => NOW)).toEqual({ status: 409, body: { error: 'plan-required' } });
    expect(t.setRenewal).not.toHaveBeenCalled();
    // cancelling never needs a plan
    expect((await webDomainRenewal('cancel-renewal', { siteId: 'fresh-cuts' }, 'Bearer owner', t.deps, () => NOW)).status).toBe(200);
  });

  it('failed, detached and transferred rows are refused like the plan-end code does', async () => {
    for (const state of ['failed', 'detached', 'transferred']) {
      const t = setup({ row: { state } });
      expect((await webDomainRenewal('resume-renewal', { siteId: 'fresh-cuts' }, 'Bearer owner', t.deps, () => NOW)).status).toBe(404);
      expect(t.setRenewal).not.toHaveBeenCalled();
    }
  });

  it('a lost state race still stores the customer-off marker and returns the real current state', async () => {
    const t = setup();
    const realUpdate = t.repo.update.bind(t.repo);
    let first = true;
    t.repo.update = (async (otid: string, from: any, patch: any, where?: any) => {
      if (first) { first = false; await realUpdate(otid, null, { state: 'manual_live' }); } // the row moves before our guarded write
      return realUpdate(otid, from, patch, where);
    }) as any;
    const r = await webDomainRenewal('cancel-renewal', { siteId: 'fresh-cuts' }, 'Bearer owner', t.deps, () => NOW);
    expect(r.status).toBe(200);
    expect(t.repo.rows.get('stripe:sub_1')!.alerts_sent).toMatchObject({ 'renewal-off-customer': expect.any(String) });
    expect(t.repo.rows.get('stripe:sub_1')!.state).toBe('manual_live');
    expect((r.body as any).autoRenew).toBe(false);
  });

  it('the panel status carries renewalOffReason on live and manual_live rows too (probe path)', async () => {
    for (const state of ['live', 'manual_live']) {
      const t = setup({ row: { state, auto_renew: false, alerts_sent: { 'renewal-off-plan-ended': 'x' } } });
      const flow: any = { repo: t.repo, vercel: { projectDomain: vi.fn(async () => ({ verified: true })), domainConfig: vi.fn(async () => ({ misconfigured: false })) }, probeHttps: vi.fn(async () => null) };
      const r = await webDomainPanelStatus({ siteId: 'fresh-cuts' }, 'Bearer owner', { ...t.deps, flow });
      expect((r.body as any).renewalOffReason).toBe('plan-ended');
    }
  });
});
