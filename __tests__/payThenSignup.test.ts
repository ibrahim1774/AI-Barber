// Pay -> required account -> live: the publish state machine, Restore, and the Bearer rules.
import fs from 'fs';
import path from 'path';
import * as store from '@/lib/siteStore';
import type { PendingPublish, SiteRecord } from '@/lib/siteStore';
import { ApiError } from '@/lib/api';
import { restore, syncIfSignedIn, pushSiteBeforeSignOut, type RestoreDeps } from '@/lib/account';
import { CLAIMED_SIGNED_OUT_MESSAGE, conflictMessage } from '@/lib/claimCopy';
import {
  CHECK_FAILED_MESSAGE, PENDING_MESSAGE, publishFlow, resumePendingPublish, type PublishDeps,
} from '@/lib/publish';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sb } = require('@/lib/supabase');

const site = {
  draftId: 'd1', inputs: { shopName: 'Fade' },
  data: {
    shopName: 'Fade', area: 'Brooklyn, NY', phone: '555',
    hero: { heading: 'Sharp', tagline: 't', imageUrl: 'https://cdn.example/h.jpg' },
    about: { heading: 'About', description: ['one'], imageUrl: '' },
    services: [{ title: 'Cut', price: '$30', description: 'd', imageUrl: '' }], gallery: [],
  },
  updatedAt: 1, slug: null, deployedUrl: null, transactionId: null,
} as unknown as SiteRecord;
const LIVE = { siteId: 'fade-brooklyn', deployedUrl: 'https://fade-brooklyn.aibarber.org', republished: false };
const START_OK = { ok: true as const, state: 'unclaimed' as const, claimExpiresAt: '2026-11-25T00:00:00.000Z' };
const err = (status: number, code: string, body?: unknown) => jest.fn(async () => { throw new ApiError(status, code, code, body); });

function makeDeps(over: Partial<PublishDeps> = {}): PublishDeps {
  return {
    hasEntitlement: jest.fn(async () => false),
    showPaywall: jest.fn(async () => 'purchased' as const),
    latestTransactionId: jest.fn(async () => 'tx-1'),
    iosPublish: jest.fn(async () => LIVE),
    claimStart: jest.fn(async () => START_OK),
    accessToken: jest.fn(async () => null),
    store,
    ...over,
  };
}
const signedIn = { accessToken: jest.fn(async () => 'tok-u1') };

beforeEach(async () => {
  jest.useRealTimers();
  sb.reset();
  await store.saveSite(site);
  await store.savePendingPublish(null);
});

describe('signed out: pay -> claim-start -> unclaimed -> /claim', () => {
  test('a purchase with no account is verified with claim-start, saved as unclaimed, and nothing is published', async () => {
    const deps = makeDeps();
    expect(await publishFlow(site, deps)).toEqual({ kind: 'claim-required' });
    expect(deps.claimStart).toHaveBeenCalledWith('tx-1');
    expect(deps.iosPublish).not.toHaveBeenCalled();
    expect(await store.loadPendingPublish()).toMatchObject({ transactionId: 'tx-1', state: 'unclaimed', data: { shopName: 'Fade' } });
    expect((await store.loadSite())?.slug).toBeNull();
  });

  test('the record exists before the transaction is looked up (a kill mid-lookup still returns to the account step)', async () => {
    let atLookup: PendingPublish | null = null;
    await publishFlow(site, makeDeps({
      latestTransactionId: jest.fn(async () => { atLookup = await store.loadPendingPublish(); return 'tx-1'; }),
    }));
    expect(atLookup).toMatchObject({ transactionId: null, state: 'unclaimed' });
  });

  test('claim-start 402 (refunded / revoked) is final: inactive, record cleared, nothing published', async () => {
    const deps = makeDeps({ claimStart: err(402, 'subscription-inactive') as never });
    expect(await publishFlow(site, deps)).toEqual({ kind: 'inactive' });
    expect(await store.loadPendingPublish()).toBeNull();
    expect(deps.iosPublish).not.toHaveBeenCalled();
  });

  test.each([
    [409, 'purchase-has-site'], [409, 'purchase-claimed'], [0, 'network'], [503, 'temporarily-unavailable'], [429, 'rate-limited'],
  ])('claim-start %i %s is bookkeeping, not a gate: a paid user still reaches the account step', async (status, code) => {
    const deps = makeDeps({ claimStart: err(status, code) as never });
    expect(await publishFlow(site, deps)).toEqual({ kind: 'claim-required' });
    expect(await store.loadPendingPublish()).toMatchObject({ state: 'unclaimed', transactionId: 'tx-1' });
    expect(deps.iosPublish).not.toHaveBeenCalled();
  });

  test('entitled (not paid just now) and the purchase is already an account\'s: blocked, nothing saved, the app is not locked', async () => {
    const deps = makeDeps({ hasEntitlement: jest.fn(async () => true), claimStart: err(409, 'purchase-claimed') as never });
    expect(await publishFlow(site, deps)).toEqual({ kind: 'blocked', message: CLAIMED_SIGNED_OUT_MESSAGE });
    expect(await store.loadPendingPublish()).toBeNull();
    expect(deps.showPaywall).not.toHaveBeenCalled();
  });

  test('a paywall "restored" is not a payment: purchase-claimed clears the record it saved and never locks the app', async () => {
    const deps = makeDeps({ showPaywall: jest.fn(async () => 'restored' as const), claimStart: err(409, 'purchase-claimed') as never });
    expect(await publishFlow(site, deps)).toEqual({ kind: 'blocked', message: CLAIMED_SIGNED_OUT_MESSAGE });
    expect(await store.loadPendingPublish()).toBeNull();
    expect(deps.iosPublish).not.toHaveBeenCalled();
  });

  test('a paywall "purchased" with the same answer still reaches the account step (they paid)', async () => {
    const deps = makeDeps({ claimStart: err(409, 'purchase-claimed') as never });
    expect(await publishFlow(site, deps)).toEqual({ kind: 'claim-required' });
  });

  test('entitled and the check cannot be made: nothing saved, say so; never a lock', async () => {
    const deps = makeDeps({ hasEntitlement: jest.fn(async () => true), claimStart: err(0, 'network') as never });
    expect(await publishFlow(site, deps)).toEqual({ kind: 'pending', message: CHECK_FAILED_MESSAGE, offline: true });
    expect(await store.loadPendingPublish()).toBeNull();
  });

  test('entitled, signed out, purchase unclaimed (or a legacy site): the account step', async () => {
    const ok = makeDeps({ hasEntitlement: jest.fn(async () => true) });
    expect(await publishFlow(site, ok)).toEqual({ kind: 'claim-required' });
    await store.savePendingPublish(null);
    const legacy = makeDeps({ hasEntitlement: jest.fn(async () => true), claimStart: err(409, 'purchase-has-site') as never });
    expect(await publishFlow(site, legacy)).toEqual({ kind: 'claim-required' });
    expect(await store.loadPendingPublish()).toMatchObject({ state: 'unclaimed' });
  });

  test('tapping Publish again while unclaimed goes straight to the account step: no paywall, no second claim-start', async () => {
    await publishFlow(site, makeDeps());
    const again = makeDeps();
    expect(await publishFlow(site, again)).toEqual({ kind: 'claim-required' });
    expect(again.showPaywall).not.toHaveBeenCalled();
    expect(again.claimStart).not.toHaveBeenCalled();
    expect(again.iosPublish).not.toHaveBeenCalled();
  });

  test('a declined paywall saves nothing', async () => {
    const deps = makeDeps({ showPaywall: jest.fn(async () => 'declined' as const) });
    expect(await publishFlow(site, deps)).toEqual({ kind: 'declined' });
    expect(await store.loadPendingPublish()).toBeNull();
    expect(deps.claimStart).not.toHaveBeenCalled();
  });
});

describe('the Bearer is never optional', () => {
  test('resume without a session never calls iosPublish: claim-required, record kept as unclaimed', async () => {
    await store.savePendingPublish({ transactionId: 'tx-9', data: site.data, createdAt: Date.now() });
    const deps = makeDeps();
    expect(await resumePendingPublish(deps)).toEqual({ kind: 'claim-required' });
    expect(deps.iosPublish).not.toHaveBeenCalled();
    expect(await store.loadPendingPublish()).toMatchObject({ transactionId: 'tx-9', state: 'unclaimed' });
  });

  test('a token that vanishes between the lookup and the send (expired, unrefreshable) sends nothing', async () => {
    await store.savePendingPublish({ transactionId: 'tx-9', data: site.data, createdAt: Date.now(), state: 'claiming' });
    const accessToken = jest.fn().mockResolvedValueOnce('tok').mockResolvedValue(null);
    const deps = makeDeps({ accessToken });
    expect(await resumePendingPublish(deps)).toEqual({ kind: 'claim-required' });
    expect(deps.iosPublish).not.toHaveBeenCalled();
    expect(await store.loadPendingPublish()).toMatchObject({ state: 'unclaimed' });
  });

  test('every successful publish carries the token as the second argument', async () => {
    const deps = makeDeps({ ...signedIn, hasEntitlement: jest.fn(async () => true) });
    await publishFlow(site, deps);
    expect((deps.iosPublish as jest.Mock).mock.calls[0][1]).toBe('tok-u1');
  });

  test('the server refusing the session (401) returns to the account step and keeps the record', async () => {
    await store.savePendingPublish({ transactionId: 'tx-9', data: site.data, createdAt: Date.now(), state: 'unclaimed' });
    const deps = makeDeps({ ...signedIn, iosPublish: err(401, 'unauthorized') as never });
    expect(await resumePendingPublish(deps)).toEqual({ kind: 'claim-required' });
    expect(await store.loadPendingPublish()).toMatchObject({ state: 'unclaimed', transactionId: 'tx-9' });
  });
});

describe('claiming: signed in after the account step', () => {
  const unclaimed = (over: Partial<PendingPublish> = {}): PendingPublish =>
    ({ transactionId: 'tx-9', data: site.data, createdAt: Date.now(), state: 'unclaimed', ...over });

  test('unclaimed + session: moves to claiming BEFORE the request, publishes with the Bearer, clears on live', async () => {
    await store.savePendingPublish(unclaimed());
    let atSend: PendingPublish | null = null;
    const deps = makeDeps({
      ...signedIn,
      iosPublish: jest.fn(async () => { atSend = await store.loadPendingPublish(); return LIVE; }),
    });
    expect(await resumePendingPublish(deps)).toMatchObject({ kind: 'live', url: LIVE.deployedUrl });
    expect(atSend).toMatchObject({ state: 'claiming' });
    expect(await store.loadPendingPublish()).toBeNull();
    expect(await store.loadSite()).toMatchObject({ slug: LIVE.siteId, transactionId: 'tx-9' });
  });

  test('a failed send keeps the claim locked (claiming) for the retry; offline says so', async () => {
    await store.savePendingPublish(unclaimed());
    const down = makeDeps({ ...signedIn, iosPublish: err(0, 'network') as never });
    expect(await resumePendingPublish(down)).toEqual({ kind: 'pending', message: PENDING_MESSAGE, offline: true });
    expect(await store.loadPendingPublish()).toMatchObject({ state: 'claiming' });
    expect(await resumePendingPublish(makeDeps(signedIn))).toMatchObject({ kind: 'live' });
  });

  test('a paid unclaimed record is never aged out, a plain one is', async () => {
    const old = Date.now() - 40 * 24 * 60 * 60 * 1000;
    await store.savePendingPublish(unclaimed({ createdAt: old }));
    expect(await resumePendingPublish(makeDeps(signedIn))).toMatchObject({ kind: 'live' });
    await store.savePendingPublish({ transactionId: 'tx-9', data: site.data, createdAt: old });
    expect(await resumePendingPublish(makeDeps(signedIn))).toBeNull();
  });

  test('an unclaimed record with no transaction and no subscription is dropped, as before', async () => {
    await store.savePendingPublish(unclaimed({ transactionId: null }));
    const deps = makeDeps({ ...signedIn, latestTransactionId: jest.fn(async () => null) });
    expect(await resumePendingPublish(deps)).toBeNull();
    expect(await store.loadPendingPublish()).toBeNull();
  });

  test('already signed in with no conflict: pay -> publish with the Bearer, no claim-start, no account step', async () => {
    const deps = makeDeps(signedIn);
    expect(await publishFlow(site, deps)).toMatchObject({ kind: 'live' });
    expect(deps.claimStart).not.toHaveBeenCalled();
    expect(deps.iosPublish).toHaveBeenCalledWith(expect.objectContaining({ transactionId: 'tx-1' }), 'tok-u1');
    expect(await store.loadPendingPublish()).toBeNull();
  });

  test('409 purchase-other-account on a claim: blocked with the masked hint, record kept as conflict, never retried', async () => {
    await store.savePendingPublish(unclaimed());
    const iosPublish = err(409, 'purchase-other-account', { hint: 'a***@gmail.com' });
    const out = await resumePendingPublish(makeDeps({ ...signedIn, iosPublish: iosPublish as never }));
    expect(out).toEqual({ kind: 'blocked', movable: true, message: conflictMessage({ code: 'purchase-other-account', hint: 'a***@gmail.com' }) });
    expect((out as { message: string }).message).toContain('a***@gmail.com');
    expect(await store.loadPendingPublish()).toMatchObject({ state: 'conflict', conflict: { code: 'purchase-other-account', hint: 'a***@gmail.com' } });
    // The next launch does not retry it (the locked step shows the conflict and offers another account).
    expect(await resumePendingPublish(makeDeps({ ...signedIn, iosPublish: iosPublish as never }))).toBeNull();
    expect(iosPublish).toHaveBeenCalledTimes(1);
  });

  test('409 purchase-changed on publish: a friendly retry line, not offline (no auto-loop), record kept', async () => {
    await store.savePendingPublish(unclaimed());
    const out = await resumePendingPublish(makeDeps({ ...signedIn, iosPublish: err(409, 'purchase-changed') as never }));
    expect(out).toMatchObject({ kind: 'pending', message: expect.stringContaining('changed accounts') });
    expect((out as { offline?: boolean }).offline).toBeUndefined();
    expect(await store.loadPendingPublish()).not.toBeNull();
  });

  test('409 account-has-site names the live site', async () => {
    await store.savePendingPublish(unclaimed());
    const out = await resumePendingPublish(makeDeps({ ...signedIn, iosPublish: err(409, 'account-has-site', { slug: 'old-cuts' }) as never }));
    expect(out).toMatchObject({ kind: 'blocked', message: expect.stringContaining('old-cuts') });
    expect(await store.loadPendingPublish()).toMatchObject({ state: 'conflict', conflict: { code: 'account-has-site', slug: 'old-cuts' } });
  });

  test('a 409 on an ordinary publish (no claim) just stops: record cleared, nothing locks the app', async () => {
    const deps = makeDeps({ ...signedIn, hasEntitlement: jest.fn(async () => true), iosPublish: err(409, 'purchase-other-account', { hint: null }) as never });
    expect(await publishFlow(site, deps)).toMatchObject({ kind: 'blocked' });
    expect(await store.loadPendingPublish()).toBeNull();
  });

  test('double tap: two taps share the queue and the paywall opens once', async () => {
    const deps = makeDeps();
    const [a, b] = await Promise.all([publishFlow(site, deps), publishFlow(site, deps)]);
    expect([a.kind, b.kind]).toEqual(['claim-required', 'claim-required']);
    expect(deps.showPaywall).toHaveBeenCalledTimes(1);
    expect(deps.claimStart).toHaveBeenCalledTimes(1);
  });
});

describe('a paid claim keeps its draft out of accounts the server may refuse', () => {
  const USER = { id: 'u-wrong', email: 'x@example.com' };
  test('syncIfSignedIn and pushSiteBeforeSignOut write nothing while the claim is locked', async () => {
    await store.savePendingPublish({ transactionId: 'tx-9', data: site.data, createdAt: Date.now(), state: 'claiming' });
    sb.setSession({ access_token: 't', user: USER });
    await syncIfSignedIn();
    expect(await pushSiteBeforeSignOut()).toBe(false);
    expect(sb.upserts).toHaveLength(0);
    expect((await store.loadSite())?.ownerUserId).toBeUndefined();
  });
  test('without a locked claim the draft is synced as before', async () => {
    sb.setSession({ access_token: 't', user: USER });
    await syncIfSignedIn();
    expect(sb.upserts).toHaveLength(1);
  });
});

describe('Restore never copies a site into another account', () => {
  const base = (over: Partial<RestoreDeps> = {}): RestoreDeps => ({
    restorePurchases: jest.fn(async () => undefined),
    latestTransactionId: jest.fn(async () => 'tx-9'),
    iosSite: jest.fn() as never,
    claimStart: jest.fn(async () => START_OK) as never,
    store,
    ...over,
  });

  test('signed in, the purchase is another account\'s (409): thrown with the hint, the phone and the account are untouched', async () => {
    sb.setSession({ access_token: 't', user: { id: 'u-b' } });
    const before = await store.loadSite();
    await expect(restore(base({
      accessToken: async () => 't', iosSite: err(409, 'purchase-other-account', { hint: 'a***@gmail.com' }) as never,
    }))).rejects.toMatchObject({ status: 409, code: 'purchase-other-account', body: { hint: 'a***@gmail.com' } });
    expect(await store.loadSite()).toEqual(before);
    expect(await store.loadPendingPublish()).toBeNull();
    expect(sb.upserts).toHaveLength(0);
  });

  test('signed in, subscribed with nothing published, and a pending publish waits: publish it into THIS account', async () => {
    sb.setSession({ access_token: 't', user: { id: 'u-b' } });
    await store.savePendingPublish({ transactionId: 'tx-9', data: site.data, createdAt: Date.now(), state: 'conflict' });
    // a conflict record is not content to claim with
    await expect(restore(base({ accessToken: async () => 't', iosSite: err(404, 'no-site') as never }))).rejects.toMatchObject({ code: 'no-site' });
    await store.savePendingPublish({ transactionId: 'tx-9', data: site.data, createdAt: Date.now(), state: 'claiming' });
    expect(await restore(base({ accessToken: async () => 't', iosSite: err(404, 'no-site') as never }))).toEqual({ claim: 'publish' });
  });

  test('signed in, nothing pending, an unpublished draft of this account: becomes a publish; another account\'s draft does not', async () => {
    sb.setSession({ access_token: 't', user: { id: 'u-b' } });
    await store.saveSite({ ...site, ownerUserId: 'u-other' } as SiteRecord);
    await expect(restore(base({ accessToken: async () => 't', iosSite: err(404, 'no-site') as never }))).rejects.toMatchObject({ code: 'no-site' });
    expect(await store.loadPendingPublish()).toBeNull();
    await store.saveSite({ ...site, ownerUserId: 'u-b' } as SiteRecord);
    expect(await restore(base({ accessToken: async () => 't', iosSite: err(404, 'no-site') as never }))).toEqual({ claim: 'publish' });
    expect(await store.loadPendingPublish()).toMatchObject({ transactionId: 'tx-9' });
  });

  test('a site pulled from the account (no slug, but live) is never republished by Restore: no claim, no record', async () => {
    sb.setSession({ access_token: 't', user: { id: 'u-b' } });
    await store.saveSite({ ...site, slug: null, deployedUrl: 'https://old-cuts.aibarber.org', ownerUserId: 'u-b' } as SiteRecord);
    await expect(restore(base({ accessToken: async () => 't', iosSite: err(404, 'no-site') as never }))).rejects.toMatchObject({ code: 'no-site' });
    expect(await store.loadPendingPublish()).toBeNull();
  });

  test('an unpublished draft claimed by Restore is an ordinary publish: a 409 stops with its words and does not lock', async () => {
    sb.setSession({ access_token: 't', user: { id: 'u-b' } });
    await store.saveSite({ ...site, ownerUserId: 'u-b' } as SiteRecord);
    expect(await restore(base({ accessToken: async () => 't', iosSite: err(404, 'no-site') as never }))).toEqual({ claim: 'publish' });
    expect((await store.loadPendingPublish())?.state).toBeUndefined();
    const out = await resumePendingPublish(makeDeps({ ...signedIn, iosPublish: err(409, 'account-has-site', { slug: 'old-cuts' }) as never }));
    expect(out).toMatchObject({ kind: 'blocked', message: expect.stringContaining('old-cuts') });
    expect(await store.loadPendingPublish()).toBeNull();
  });

  test('signed out + paid-unclaimed: never asks the site endpoint; the pending publish is saved as unclaimed -> /claim', async () => {
    const iosSite = jest.fn();
    const out = await restore(base({ accessToken: async () => null, iosSite: iosSite as never }));
    expect(out).toEqual({ claim: 'sign-up' });
    expect(iosSite).not.toHaveBeenCalled();
    expect(await store.loadPendingPublish()).toMatchObject({ transactionId: 'tx-9', state: 'unclaimed', data: { shopName: 'Fade' } });
  });

  test('signed out + the purchase belongs to an account: sign in first, nothing saved or copied', async () => {
    await expect(restore(base({ accessToken: async () => null, claimStart: err(409, 'purchase-claimed') as never })))
      .rejects.toMatchObject({ code: 'sign-in-required' });
    expect(await store.loadPendingPublish()).toBeNull();
  });

  test('signed out with nothing built on the phone: says nothing was published yet', async () => {
    await store.clearSite();
    await expect(restore(base({ accessToken: async () => null }))).rejects.toMatchObject({ code: 'no-site' });
  });
});

describe('/api/ios/site is requested in one place, with the Bearer', () => {
  const walk = (dir: string): string[] =>
    fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = path.join(dir, e.name);
      return e.isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(e.name) ? [p] : [];
    });
  test('only api.ts requests the endpoint (as code), and it fetches the token itself', () => {
    const root = path.join(__dirname, '..', 'src');
    const named = walk(root).filter((f) => /['"`]\/api\/ios\/site['"`]/.test(fs.readFileSync(f, 'utf8')));
    expect(named.map((f) => path.relative(root, f))).toEqual(['lib/api.ts']);
  });
  test('the old no-account paths are gone', () => {
    const src = walk(path.join(__dirname, '..', 'src')).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    for (const dead of ['freshBind', 'BOUND_ELSEWHERE', 'boundElsewhere', 'checkBound']) expect(src).not.toContain(dead);
  });
});
