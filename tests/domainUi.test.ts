import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  DOMAIN_DISCLOSURE, DOMAIN_PRICE_LABEL, clearDomainCheckout, comDomainFrom, domainSiteId, panelView,
  rememberDomainCheckout, takeDomainCheckout,
} from '../services/domainUi';
import { webDomainPanelStatus, webDomainPortal } from '../lib/webDomains';
import { fakeDomainsRepo, blankRow } from './ios/fakeDomainsRepo';

const src = fs.readFileSync(path.join(process.cwd(), 'components/DomainManager.tsx'), 'utf8');
const app = fs.readFileSync(path.join(process.cwd(), 'App.tsx'), 'utf8');

describe('DomainManager (source checks)', () => {
  it('shows $39/year and the exact disclosure; never a monthly equivalent', () => {
    expect(DOMAIN_PRICE_LABEL).toBe('$39/year');
    expect(DOMAIN_DISCLOSURE).toBe("Registered by AI Barber for your site. If you ever leave, contact support@davoxa.com and we'll transfer it to you.");
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
    expect(await webDomainPanelStatus({ siteId: 'fresh-cuts' }, 'Bearer owner', deps)).toMatchObject({ body: { refunded: true } });
  });

  it("portal: the owner gets the portal of THIS domain subscription's customer; strangers 403", async () => {
    const { deps, createPortalSession } = setup();
    expect(await webDomainPortal({ siteId: 'fresh-cuts' }, 'Bearer owner', 'https://www.aibarber.org', deps)).toEqual({ status: 200, body: { url: 'https://billing.stripe.com/p' } });
    expect(createPortalSession).toHaveBeenCalledWith('cus_1', 'https://www.aibarber.org');
    expect((await webDomainPortal({ siteId: 'fresh-cuts' }, 'Bearer x', 'o', deps)).status).toBe(403);
  });
});
