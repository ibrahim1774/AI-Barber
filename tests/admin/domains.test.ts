import { describe, it, expect, vi } from 'vitest';
import { domainTransferred, findSites, getSite } from '../../lib/admin/sites.js';
import { blankRow } from '../ios/fakeDomainsRepo.js';
import { fakes, purchase, NOW, iso } from './fakeDeps.js';

const live = blankRow({ original_transaction_id: 'd-1', site_slug: 'fade-lab', domain: 'fadelab.com', state: 'live', paid_until: iso(NOW + 1e9), updated_at: iso(NOW) });
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
