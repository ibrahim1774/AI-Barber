// Relaunch while paid-unclaimed returns to the locked account step, before anything else.
import * as store from '@/lib/siteStore';
import type { PendingPublish, SiteRecord } from '@/lib/siteStore';
import { CLAIM_ALLOWED_PATHS, claimLocked, reopenClaim, shouldLockToClaim } from '@/lib/claimGuard';
import { launchRoute } from '@/lib/launchRoute';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sb } = require('@/lib/supabase');

const data: any = { shopName: 'Fade', area: 'x', phone: '5', hero: {}, about: {}, services: [], gallery: [] };
const rec = { draftId: 'd', inputs: { shopName: 'Fade' }, data, updatedAt: 1, slug: null, deployedUrl: null, transactionId: null } as unknown as SiteRecord;
const pend = (over: Partial<PendingPublish> = {}): PendingPublish => ({ transactionId: 'tx-1', data, createdAt: Date.now(), ...over });

beforeEach(async () => {
  sb.reset();
  await store.clearSite();
  await store.savePendingPublish(null);
});

describe('shouldLockToClaim', () => {
  test.each([
    ['nothing pending', null, false, false],
    ['nothing pending, signed in', null, true, false],
    ['unclaimed, no session', pend({ state: 'unclaimed' }), false, true],
    ['claiming, no session', pend({ state: 'claiming' }), false, true],
    ['a plain pending (older build), no session', pend(), false, true],
    ['unclaimed, with a session: the publish resumes by itself', pend({ state: 'unclaimed' }), true, false],
    ['claiming, with a session', pend({ state: 'claiming' }), true, false],
    ['a conflict stays locked even with a session', pend({ state: 'conflict' }), true, true],
  ] as const)('%s', (_n, p, session, locked) => {
    expect(shouldLockToClaim(p as PendingPublish | null, session)).toBe(locked);
  });
});

describe('launch', () => {
  test('a kill mid-flow (paid, unclaimed, no session) reopens on /claim, even with a site on the phone', async () => {
    await store.saveSite(rec);
    await store.savePendingPublish(pend({ state: 'unclaimed' }));
    expect(await claimLocked()).toBe(true);
    expect(await launchRoute()).toBe('/claim');
  });
  test('an older build\'s paid record with no state, no session, also lands on /claim', async () => {
    await store.savePendingPublish(pend());
    expect(await launchRoute()).toBe('/claim');
  });
  test('with a session the unclaimed record is resumed in place: the editor opens (ResumePublish sends it)', async () => {
    await store.saveSite(rec);
    await store.savePendingPublish(pend({ state: 'unclaimed' }));
    sb.setSession({ access_token: 't', user: { id: 'u1' } });
    expect(await launchRoute()).toBe('/edit');
  });
  test('a refused claim returns to /claim even with a session', async () => {
    await store.saveSite(rec);
    await store.savePendingPublish(pend({ state: 'conflict', conflict: { code: 'purchase-other-account', hint: 'a***@x.com' } }));
    sb.setSession({ access_token: 't', user: { id: 'u1' } });
    expect(await launchRoute()).toBe('/claim');
  });
  test('nothing pending: the normal home (importer / editor)', async () => {
    expect(await launchRoute()).toBe('/start');
    await store.saveSite(rec);
    expect(await launchRoute()).toBe('/edit');
  });
  test('an unreadable disk never traps: no lock', async () => {
    const spy = jest.spyOn(store, 'loadPendingPublish').mockRejectedValue(new Error('disk'));
    expect(await claimLocked()).toBe(false);
    spy.mockRestore();
  });
});

describe('the lock leaves room only for the flow itself', () => {
  test('the account step, the publish overlay and password reset', () => {
    expect([...CLAIM_ALLOWED_PATHS].sort()).toEqual(['/claim', '/forgot-password', '/publishing', '/reset-password']);
  });
  test('reopenClaim clears a conflict and makes the record unclaimed again', async () => {
    await store.savePendingPublish(pend({ state: 'conflict', conflict: { code: 'account-has-site', slug: 's' } }));
    await reopenClaim();
    const p = await store.loadPendingPublish();
    expect(p).toMatchObject({ state: 'unclaimed', transactionId: 'tx-1' });
    expect(p?.conflict).toBeUndefined();
  });
});
