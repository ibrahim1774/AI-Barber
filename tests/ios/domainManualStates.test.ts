import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  markTransferred, releaseDomainsForRemoval, reserveSlot, sweepDomains, type DomainFlowDeps,
} from '../../lib/ios/domainFlow.js';
import {
  ATTACHED_STATES, DOMAIN_STATES, OWNED_STATES, RESUMABLE_STATES, SITE_HOLDING_STATES, OWNER_REMOVED,
} from '../../lib/ios/domainsRepo.js';
import { fakeDomainsRepo, blankRow } from './fakeDomainsRepo.js';
import { fakeRegistrar } from './fakeRegistrar.js';

// Step M0 (manual web fulfilment): awaiting_setup and manual_live are machine-inert states.
const T0 = 1_800_000_000_000;
const DAY = 24 * 3600_000;
const iso = (ms: number) => new Date(ms).toISOString();

function seedRows() {
  const base = {
    source: 'stripe' as const,
    paid_until: iso(T0 - 5 * DAY), // lapsed: would be picked up by a lapse pass if the state allowed
    revoked_at: iso(T0 - DAY),
    payer_checked_at: null,
    auto_renew: true,
    auto_renew_synced: false,
    dns_ready_at: null,
    failure_reason: null,
  };
  return [
    blankRow({ ...base, original_transaction_id: 'stripe:sub_a', site_slug: 'a-shop', domain: 'a-shop.com', state: 'awaiting_setup' }),
    blankRow({ ...base, original_transaction_id: 'stripe:sub_b', site_slug: 'b-shop', domain: 'b-shop.com', state: 'awaiting_setup', simulated: true }),
    blankRow({ ...base, original_transaction_id: 'stripe:sub_c', site_slug: 'c-shop', domain: 'c-shop.com', state: 'manual_live', linked_at: iso(T0 - 9 * DAY) }),
    blankRow({ ...base, original_transaction_id: 'stripe:sub_d', site_slug: 'd-shop', domain: 'd-shop.com', state: 'manual_live', simulated: true, linked_at: iso(T0 - 9 * DAY) }),
  ];
}

function world(seed = seedRows()) {
  const now = () => T0;
  const reg = fakeRegistrar({ now });
  const repo = fakeDomainsRepo(seed, now);
  const payer = vi.fn(async () => ({ active: true, autoRenew: true, expiresAt: T0 + DAY, revoked: false }));
  const notifySupport = vi.fn(async () => {});
  const cancelAndRefund = vi.fn(async () => {});
  const probeHttps = vi.fn(async () => true);
  const hooks = { onDomainLinked: vi.fn(async () => {}), onDomainUnlinked: vi.fn(async () => {}) };
  const deps = {
    repo, vercel: reg.api, contact: null, payer, hooks, now, notifySupport, cancelAndRefund, probeHttps,
    verifyDomain: vi.fn(), verifySite: vi.fn(), sitePurchase: async () => null,
  } as unknown as DomainFlowDeps;
  return { deps, repo, reg, payer, notifySupport, cancelAndRefund, probeHttps, hooks };
}

const apiCalls = (reg: ReturnType<typeof fakeRegistrar>) =>
  Object.entries(reg.api as unknown as Record<string, { mock?: { calls: unknown[] } }>)
    .filter(([, fn]) => fn?.mock?.calls.length).map(([name]) => name);

describe('migration 030 and the state lists', () => {
  const s = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/030_ios_domains_manual_states.sql'), 'utf8');
  const code = s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  const list = (m: RegExpMatchArray | null) => m![1].match(/'([a-z_]+)'/g)!.map((x) => x.replace(/'/g, ''));

  it('widens the state check to exactly DOMAIN_STATES and the site index to exactly SITE_HOLDING_STATES', () => {
    expect(list(code.match(/check \(state in \(([^)]*)\)\)/))).toEqual([...DOMAIN_STATES]);
    expect(list(code.match(/ios_domains_site_key[\s\S]*?where state in \(([^)]*)\)/))).toEqual([...SITE_HOLDING_STATES]);
  });

  it('is additive and idempotent: only ios_domains, drop-if-exists then re-add, no data change', () => {
    expect(s).toMatch(/NOT APPLIED/);
    expect(code).toMatch(/drop constraint if exists ios_domains_state_check/);
    expect(code).toMatch(/drop index if exists public\.ios_domains_site_key/);
    expect(code).toMatch(/create unique index if not exists ios_domains_site_key/);
    expect(code.match(/alter table public\.(\w+)/g)).toEqual(['alter table public.ios_domains', 'alter table public.ios_domains']);
    expect(code).not.toMatch(/\b(delete|truncate|update|insert|grant|create policy|drop table|drop column)\b/i);
  });

  it('the manual states hold the site slot and are in no machine list', () => {
    for (const st of ['awaiting_setup', 'manual_live'] as const) {
      expect(DOMAIN_STATES).toContain(st);
      expect(SITE_HOLDING_STATES).toContain(st);
      expect(RESUMABLE_STATES).not.toContain(st);
      expect(OWNED_STATES).not.toContain(st);
      expect(ATTACHED_STATES).not.toContain(st);
    }
  });
});

describe('sweepDomains ignores manual rows', () => {
  it('no step, no registrar/project call, no payer call, no state change, no alert, no refund', async () => {
    const w = world();
    const before = JSON.stringify([...w.repo.rows.values()]);
    const out = await sweepDomains(w.deps, { deadline: T0 + 60_000 });
    expect(out).toMatchObject({
      resumed: [], live: [], failed: [], waiting: [], detached: [], reattached: [], stillActive: [], refreshed: [],
      autoRenewSynced: [], relinked: [], payerUnavailable: [], refunded: [], alerted: [], deferred: [], errors: [],
    });
    expect(apiCalls(w.reg)).toEqual([]);
    expect(w.payer).not.toHaveBeenCalled();
    expect(w.probeHttps).not.toHaveBeenCalled();
    expect(w.notifySupport).not.toHaveBeenCalled();
    expect(w.cancelAndRefund).not.toHaveBeenCalled();
    expect(w.hooks.onDomainLinked).not.toHaveBeenCalled();
    expect(w.hooks.onDomainUnlinked).not.toHaveBeenCalled();
    expect(JSON.stringify([...w.repo.rows.values()])).toBe(before);
  });

  it('stays inert across repeated sweeps and a much later clock', async () => {
    const w = world();
    const before = JSON.stringify([...w.repo.rows.values()]);
    for (let i = 0; i < 3; i++) await sweepDomains(w.deps, { deadline: T0 + 60_000 });
    const later = { ...w.deps, now: () => T0 + 400 * DAY } as DomainFlowDeps;
    await sweepDomains(later, { deadline: T0 + 401 * DAY });
    expect(apiCalls(w.reg)).toEqual([]);
    expect(w.notifySupport).not.toHaveBeenCalled();
    expect(JSON.stringify([...w.repo.rows.values()])).toBe(before);
  });
});

describe('the slot', () => {
  const claim = (slug: string, domain: string, key = 'o-apple') => ({
    key, source: 'apple' as const, environment: 'Production' as const, slug, domain, simulated: false,
    payer: { active: true, autoRenew: true, expiresAt: T0 + 365 * DAY, revoked: false },
  });

  it('an iOS claim on a slug held by an awaiting_setup or manual_live row is refused: site-has-domain', async () => {
    const w = world();
    for (const slug of ['a-shop', 'b-shop', 'c-shop', 'd-shop']) {
      const r = await reserveSlot(claim(slug, 'new-name.com'), w.deps);
      expect(r.result).toMatchObject({ status: 409, body: { error: 'site-has-domain' } });
    }
    expect(w.repo.rows.has('o-apple')).toBe(false);
    expect(w.reg.api.buy).not.toHaveBeenCalled();
  });

  it('holdingSite returns manual rows; the fake enforces one holding row per site', async () => {
    const w = world();
    expect((await w.repo.holdingSite('a-shop'))?.state).toBe('awaiting_setup');
    expect((await w.repo.holdingSite('c-shop'))?.state).toBe('manual_live');
    expect(await w.repo.holdingSite('nobody')).toBeNull();
    const dup = await w.repo.insertAwaitingSetup({
      original_transaction_id: 'stripe:sub_dup', source: 'stripe', environment: 'Production', site_slug: 'a-shop', domain: 'dup.com', simulated: false, auto_renew: false,
    });
    expect(dup).toBe('conflict');
  });

  it('insertAwaitingSetup parks a paid row in awaiting_setup; replay conflicts; a free slug works', async () => {
    const w = world([]);
    const n = { original_transaction_id: 'stripe:sub_n', source: 'stripe' as const, environment: 'Production' as const, site_slug: 'n-shop', domain: 'n-shop.com', simulated: false, auto_renew: true };
    expect(await w.repo.insertAwaitingSetup(n)).toBe('ok');
    expect((await w.repo.get('stripe:sub_n'))?.state).toBe('awaiting_setup');
    expect(await w.repo.insertAwaitingSetup(n)).toBe('conflict');
  });

  it('a transferred (manual-ended) row frees the slot', async () => {
    const w = world();
    await w.repo.update('stripe:sub_c', ['manual_live'], { state: 'transferred', transferred_by: 'manual-ended' });
    expect(await w.repo.holdingSite('c-shop')).toBeNull();
    const r = await reserveSlot(claim('c-shop', 'fresh-name.com'), w.deps);
    expect(r.row?.state).toBe('reserved');
  });
});

describe('removal and transfer', () => {
  it('releaseDomainsForRemoval moves manual rows to detached/owner-removed and removes project domains for real rows only', async () => {
    const w = world();
    for (const slug of ['a-shop', 'b-shop', 'c-shop', 'd-shop']) await releaseDomainsForRemoval(slug, w.deps);
    for (const k of ['sub_a', 'sub_b', 'sub_c', 'sub_d']) {
      const r = await w.repo.get(`stripe:${k}`);
      expect(r).toMatchObject({ state: 'detached', failure_reason: OWNER_REMOVED });
      expect(r!.detached_at).toBeTruthy();
    }
    // real rows a and c: www + apex removed from the slug's project; simulated b and d never call Vercel
    expect(w.reg.api.removeProjectDomain).toHaveBeenCalledTimes(4);
    const removed = (w.reg.api.removeProjectDomain as unknown as { mock: { calls: string[][] } }).mock.calls.map((c) => c[1]).sort();
    expect(removed).toEqual(['a-shop.com', 'c-shop.com', 'www.a-shop.com', 'www.c-shop.com']);
    expect(w.reg.api.buy).not.toHaveBeenCalled();
  });

  it('markTransferred ignores manual rows', async () => {
    const w = world();
    const before = JSON.stringify([...w.repo.rows.values()]);
    for (const slug of ['a-shop', 'c-shop']) expect(await markTransferred(slug, 'admin', w.deps)).toEqual({ ok: false, error: 'no-domain' });
    expect(JSON.stringify([...w.repo.rows.values()])).toBe(before);
  });
});
