import { describe, it, expect, vi } from 'vitest';
import { domainTransferred, findSites, getSite } from '../../lib/admin/sites.js';
import { blankRow } from '../ios/fakeDomainsRepo.js';
import { fakes, purchase, NOW, iso } from './fakeDeps.js';

const live = blankRow({ original_transaction_id: 'd-1', site_slug: 'fade-lab', domain: 'fadelab.com', state: 'live', auto_renew: true, paid_until: iso(NOW + 1e9), updated_at: iso(NOW) });
const oldFailed = blankRow({ original_transaction_id: 'd-0', site_slug: 'fade-lab', domain: 'fadelabnyc.com', state: 'failed', failure_reason: 'taken', updated_at: iso(NOW + 5) });

describe('admin App sites: custom domain', () => {
  it('each site shows its domain and state (the holding row wins over an old failed one); searchable by domain', async () => {
    const f = fakes({ rows: [purchase('fade-lab'), purchase('elite-cuts')] });
    f.deps.domains = vi.fn(async () => [oldFailed, live]);
    const rows = await findSites('', f.deps);
    expect(rows.find((r) => r.slug === 'fade-lab')!.customDomain).toMatchObject({ domain: 'fadelab.com', state: 'live', internalState: 'live', sandbox: false });
    expect(rows.find((r) => r.slug === 'elite-cuts')!.customDomain).toBeNull();
    expect((await findSites('fadelab.com', f.deps)).map((r) => r.slug)).toEqual(['fade-lab']);
    const one = await getSite('fade-lab', f.deps);
    expect(one.site!.customDomain).toMatchObject({ domain: 'fadelab.com', state: 'live' });
  });

  it('a domain read failure leaves the column empty, never breaks the list', async () => {
    const f = fakes();
    f.deps.domains = vi.fn(async () => { throw new Error('db'); });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await findSites('', f.deps))[0].customDomain).toBeNull();
  });

  it('without domain deps (older wiring) the column is null', async () => {
    expect((await findSites('', fakes().deps))[0].customDomain).toBeNull();
  });

  it('domain-transferred calls the lifecycle with who did it', async () => {
    const f = fakes();
    f.deps.markDomainTransferred = vi.fn(async () => ({ ok: true, domain: 'fadelab.com' }));
    expect(await domainTransferred('fade-lab', f.deps, 'admin@x')).toEqual({ ok: true, slug: 'fade-lab', domain: 'fadelab.com' });
    expect(f.deps.markDomainTransferred).toHaveBeenCalledWith('fade-lab', 'admin@x');
    f.deps.markDomainTransferred = vi.fn(async () => ({ ok: false, error: 'no-domain' }));
    expect(await domainTransferred('fade-lab', f.deps)).toEqual({ ok: false, slug: 'fade-lab', error: 'not-found' });
  });
});

describe('admin: Vercel account domains (READ-ONLY listing)', () => {
  it('lists every domain with auto-renew and expiry, marking which the lifecycle manages; never writes', async () => {
    const { listAccountDomains } = await import('../../lib/admin/sites.js');
    const f = fakes();
    f.deps.domains = vi.fn(async () => [live]);
    f.deps.vercelDomains = vi.fn(async () => [
      { name: 'oldweb.com', boughtAt: NOW - 1e9, expiresAt: NOW + 1e9, renew: true, serviceType: 'zeit.world' },
      { name: 'fadelab.com', boughtAt: NOW - 1e8, expiresAt: NOW + 2e9, renew: false, serviceType: 'zeit.world' },
      { name: 'external.com', boughtAt: null, expiresAt: null, renew: false, serviceType: 'external' },
    ]);
    const r = await listAccountDomains(f.deps);
    expect(r.ok).toBe(true);
    expect(r.domains!.map((d) => [d.name, d.autoRenew, d.boughtThroughVercel, d.tracked?.state ?? null])).toEqual([
      ['oldweb.com', true, true, null],
      ['fadelab.com', false, true, 'live'],
      ['external.com', false, false, null],
    ]);
    expect(f.deps.publish).not.toHaveBeenCalled();
  });

  it('not configured → error', async () => {
    const { listAccountDomains } = await import('../../lib/admin/sites.js');
    expect(await listAccountDomains(fakes().deps)).toEqual({ ok: false, error: 'not-configured' });
  });

  it('domain-buy-release: retry | abandon only', async () => {
    const { domainBuyRelease } = await import('../../lib/admin/sites.js');
    const f = fakes();
    f.deps.releaseStuckDomainBuy = vi.fn(async () => ({ ok: true, domain: 'x.com' }));
    expect(await domainBuyRelease('fade-lab', 'retry', f.deps, 'a')).toEqual({ ok: true, slug: 'fade-lab', domain: 'x.com' });
    expect(await domainBuyRelease('fade-lab', 'yolo', f.deps, 'a')).toEqual({ ok: false, slug: 'fade-lab', error: 'bad-request' });
  });
});
