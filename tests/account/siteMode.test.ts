import { describe, expect, it, vi } from 'vitest';
import { accountDraftsCovers, nativeBuild, nativeModeGate, oldRouteGate, siteModeFromKind, siteModeOf } from '../../lib/account/siteMode.js';
import { accountPlan } from '../../lib/account/plan.js';
import type { AccountKind } from '../../lib/account/kind.js';

const U = '11111111-1111-4111-8111-111111111111';
const V = '22222222-2222-4222-8222-222222222222';
const KINDS: AccountKind[] = ['web', 'apple', 'mixed', 'neither'];
const STATES: Record<string, Record<string, string>> = {
  off: {}, 'unknown value': { ACCOUNT_DRAFTS_IOS: 'yes' },
  'allowlist (user listed)': { ACCOUNT_DRAFTS_IOS: 'allowlist', ACCOUNT_DRAFTS_IOS_USERS: ` ${V}, ${U.toUpperCase()} ` },
  'allowlist (user not listed)': { ACCOUNT_DRAFTS_IOS: 'allowlist', ACCOUNT_DRAFTS_IOS_USERS: V },
  'allowlist (empty)': { ACCOUNT_DRAFTS_IOS: 'allowlist' },
  all: { ACCOUNT_DRAFTS_IOS: 'all' },
};

describe('siteModeFromKind', () => {
  const covered = new Set(['allowlist (user listed)', 'all']);
  for (const [name, env] of Object.entries(STATES)) for (const kind of KINDS) {
    it(`${kind} / ${name}`, () => {
      const want = kind !== 'web' ? 'device' : covered.has(name) ? 'account' : 'web-only';
      expect(siteModeFromKind(kind, U, env)).toBe(want);
    });
  }
  it('a web account is never device, even with the switch fully off', () => { expect(siteModeFromKind('web', U, {})).toBe('web-only'); });
  it('account is unreachable for apple, mixed and neither under every state', () => {
    for (const env of Object.values(STATES)) for (const k of ['apple', 'mixed', 'neither'] as const) expect(siteModeFromKind(k, U, env)).toBe('device');
  });
  it('accountDraftsCovers reads the list case-insensitively', () => { expect(accountDraftsCovers(U, STATES['allowlist (user listed)'])).toBe(true); });
});

describe('siteModeOf', () => {
  it('uses the kind reading and throws on a lookup failure', async () => {
    expect(await siteModeOf(U, { kind: async () => 'web', env: { ACCOUNT_DRAFTS_IOS: 'all' } })).toBe('account');
    await expect(siteModeOf(U, { kind: async () => { throw new Error('db'); } })).rejects.toThrow('db');
  });
});

describe('getPlan capabilities.siteMode (accountPlan)', () => {
  const deps = (kind: 'web' | 'apple') => ({
    webSites: async () => (kind === 'web' ? [{ slug: 'w', published_at: '2026-01-01' }] : []),
    applePurchases: async () => (kind === 'apple' ? [{ original_transaction_id: 'o', product_id: 'com.ibrahim1774.aibarber.hosting.monthly', environment: 'Production', site_slug: 'a', user_id: U, expires_at: '2099-01-01', revoked_at: null, taken_down_at: null }] : []),
    entitlements: async () => [], isFree: async () => false, legacyOwner: async () => false, now: () => Date.parse('2026-11-18T00:00:00Z'),
  } as any);
  it('follows the kind and the switch', async () => {
    vi.stubEnv('ACCOUNT_DRAFTS_IOS', ''); 
    expect((await accountPlan(U, 'Production', deps('web'))).siteMode).toBe('web-only');
    vi.stubEnv('ACCOUNT_DRAFTS_IOS', 'all');
    expect((await accountPlan(U, 'Production', deps('web'))).siteMode).toBe('account');
    expect((await accountPlan(U, 'Production', deps('apple'))).siteMode).toBe('device');
    vi.unstubAllEnvs();
  });
});

describe('gates', () => {
  const boom = { kind: async (): Promise<AccountKind> => { throw new Error('no reads without the header'); } };
  const withHdr = (h: any = { 'x-pb-build': '57' }) => ({ headers: h });
  it('nativeBuild: present, any value, trimmed; absent or empty is not native', () => {
    expect(nativeBuild(withHdr())).toBe('57');
    expect(nativeBuild({ headers: { 'x-pb-build': ' ' } })).toBeNull();
    expect(nativeBuild({ headers: {} })).toBeNull();
  });
  it('nativeModeGate: no header returns null and reads nothing', async () => {
    expect(await nativeModeGate({ headers: {} }, U, boom)).toBeNull();
  });
  it('nativeModeGate: native in account mode passes; web-only, device are 403 not-account-mode; a failure is 503', async () => {
    expect(await nativeModeGate(withHdr(), U, { kind: async () => 'web', env: { ACCOUNT_DRAFTS_IOS: 'all' } })).toBeNull();
    expect(await nativeModeGate(withHdr(), U, { kind: async () => 'web', env: {} })).toEqual({ status: 403, body: { error: 'not-account-mode' } });
    expect(await nativeModeGate(withHdr(), U, { kind: async () => 'apple', env: { ACCOUNT_DRAFTS_IOS: 'all' } })).toEqual({ status: 403, body: { error: 'not-account-mode' } });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await nativeModeGate(withHdr(), U, boom)).toEqual({ status: 503, body: { error: 'temporarily-unavailable' } });
  });
  it('oldRouteGate: no header returns null without even asking who the caller is', async () => {
    const userOf = vi.fn(async () => ({ id: U }));
    expect(await oldRouteGate({ headers: { authorization: 'Bearer t' } }, userOf, boom)).toBeNull();
    expect(userOf).not.toHaveBeenCalled();
  });
  it('oldRouteGate: native in account or web-only mode is 409 use-account-publish; device, no token, a bad token pass through', async () => {
    const h = { 'x-pb-build': '57', authorization: 'Bearer t' };
    const userOf = async () => ({ id: U });
    expect(await oldRouteGate({ headers: h }, userOf, { kind: async () => 'web', env: { ACCOUNT_DRAFTS_IOS: 'all' } })).toEqual({ status: 409, body: { error: 'use-account-publish' } });
    expect(await oldRouteGate({ headers: h }, userOf, { kind: async () => 'apple', env: { ACCOUNT_DRAFTS_IOS: 'all' } })).toBeNull();
    expect(await oldRouteGate({ headers: h }, userOf, { kind: async () => 'web', env: {} })).toEqual({ status: 409, body: { error: 'use-account-publish' } }); // web-only too
    expect(await oldRouteGate({ headers: { 'x-pb-build': '57' } }, userOf, boom)).toBeNull();
    expect(await oldRouteGate({ headers: h }, async () => null, boom)).toBeNull();
  });
  it('oldRouteGate: a lookup failure for a native caller is 503', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await oldRouteGate({ headers: { 'x-pb-build': '57', authorization: 'Bearer t' } }, async () => ({ id: U }), boom)).toEqual({ status: 503, body: { error: 'temporarily-unavailable' } });
  });
});
