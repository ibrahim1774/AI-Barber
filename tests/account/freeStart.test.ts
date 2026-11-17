// The Free start path: assignGroup(..., 'free') is the only place WEB_APP_FREE_START is read (callers: api/web-app/price-group.ts and
// api/web-app/checkout.ts). An account that holds an Apple address is not given a Free site when ONE_SITE_GUARD=1.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ groups: [] as any[], calls: [] as any[], apple: false, kindFails: false, kindCalls: 0, alerts: [] as any[] }));
vi.mock('../../lib/webApp/webAppServer.js', () => ({
  stripeCall: async () => ({ data: [] }),
  sbRest: async (path: string, init: any = {}) => {
    db.calls.push({ path, ...init });
    if (path.startsWith('web_app_price_groups')) {
      if ((init.method ?? 'GET') === 'GET') return db.groups.slice(0, 1);
      if (!db.groups.length) db.groups.push(init.body);
      return null;
    }
    return [];
  },
}));
vi.mock('../../lib/webApp/appStoreGuard.js', () => ({ appStoreStateOf: async () => null }));
vi.mock('../../lib/webApp/emails.js', () => ({ alertOwner: async (...a: any[]) => { db.alerts.push(a); } }));
vi.mock('../../lib/account/kind.js', async (orig) => ({
  ...(await orig<typeof import('../../lib/account/kind.js')>()),
  accountKindReading: async () => { db.kindCalls++; if (db.kindFails) throw new Error('db'); return { kind: db.apple ? 'apple' : 'neither', holdsAppleAddress: db.apple }; },
}));

import { assignGroup } from '../../lib/webApp/priceGroup.js';

let n = 0;
beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x'); vi.stubEnv('WEB_APP_FREE_OPEN', '1'); vi.stubEnv('WEB_APP_FREE_START', '2026-11-12T00:00:00Z');
  vi.stubEnv('SUPABASE_URL', 'https://sb.test'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'k');
  Object.assign(db, { groups: [], calls: [], apple: false, kindFails: false, kindCalls: 0, alerts: [] });
  vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => ({ created_at: '2026-11-13T00:00:00Z' }) }));
});
const free = () => assignGroup(`u${++n}`, 'o@example.com', 'free', 'client');

describe('Free start and an Apple address', () => {
  it('OFF: an Apple address changes nothing and nothing new is read', async () => {
    db.apple = true;
    expect(await free()).toBe('free');
    expect(db.kindCalls).toBe(0);
    expect(db.alerts).toHaveLength(0);
  });
  it('1: an account with an Apple address is refused the Free site (stored base, like the App Store branch)', async () => {
    vi.stubEnv('ONE_SITE_GUARD', '1');
    db.apple = true;
    expect(await free()).toBe('base');
    expect(db.groups[0].price_group).toBe('base');
  });
  it('1: an account with no Apple address still gets the Free site', async () => {
    vi.stubEnv('ONE_SITE_GUARD', '1');
    expect(await free()).toBe('free');
    expect(db.kindCalls).toBe(1);
  });
  it('alert: the owner is told once, the Free site is granted as today', async () => {
    vi.stubEnv('ONE_SITE_GUARD', 'alert');
    db.apple = true;
    expect(await free()).toBe('free');
    expect(db.alerts).toHaveLength(1);
  });
  it('a read error: alert ignores it; 1 throws (the caller\'s usual 502) and stores nothing', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    db.kindFails = true;
    vi.stubEnv('ONE_SITE_GUARD', 'alert');
    expect(await free()).toBe('free');
    db.groups = [];
    vi.stubEnv('ONE_SITE_GUARD', '1');
    await expect(free()).rejects.toThrow('db');
    expect(db.groups).toHaveLength(0);
  });
  it('a plain base request never reads the account kind', async () => {
    vi.stubEnv('ONE_SITE_GUARD', '1');
    db.apple = true;
    expect(await assignGroup('ub', null, 'base', 'client')).toBe('base');
    expect(db.kindCalls).toBe(0);
  });
});
