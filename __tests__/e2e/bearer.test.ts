/**
 * The server links a purchase to an account only from a verified Supabase bearer (I6): /api/ios/publish
 * carries `Authorization: Bearer <access token>` whenever signed in (refreshed first when near expiry; the owner calls (shop/plan, shop/setup) and the domain claim
 * use the same token.
 */
jest.mock('expo-superwall', () => require('./mocks').superwallMock());
jest.mock('expo-sqlite/kv-store', () => require('./mocks').diskMock());

import { Alert } from 'react-native';
import { DOMAIN_PRODUCT, FakeServer, P, boot, draft, installFetch, type World } from './harness';
import { wipeDisk } from './mocks';

let server: FakeServer;
let w: World;

beforeEach(() => {
  jest.resetModules();
  wipeDisk();
  server = new FakeServer();
  installFetch(server);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  try {
    w?.unmount();
  } catch {
    /* unmounted */
  }
  jest.restoreAllMocks();
});

const drain = () => new Promise((r) => setTimeout(r, 20));
const nowS = () => Math.floor(Date.now() / 1000);

async function publish() {
  const site = await w.site();
  return w.m.publish.publishFlow(site!, w.deps);
}

describe('accessToken', () => {
  it('signed out: null; a fresh session: its token, no refresh', async () => {
    w = await boot(server, { user: null });
    const { accessToken } = require('@/lib/accessToken');
    expect(await accessToken()).toBeNull();
    w.sb.setSession({ access_token: 'tok-a', expires_at: nowS() + 3600, user: { id: 'u1' } } as any);
    expect(await accessToken()).toBe('tok-a');
    expect(require('@/lib/supabase').supabase.auth.refreshSession).not.toHaveBeenCalled();
  });

  it('near expiry: refreshed first, the new token is used', async () => {
    w = await boot(server, { user: null });
    const { supabase } = require('@/lib/supabase');
    w.sb.setSession({ access_token: 'tok-old', expires_at: nowS() + 30, user: { id: 'u1' } } as any);
    supabase.auth.refreshSession.mockImplementation(async () => ({ data: { session: { access_token: 'tok-new', user: { id: 'u1' } } }, error: null }));
    expect(await require('@/lib/accessToken').accessToken()).toBe('tok-new');
  });

  it('refresh failing: the old token while it still works, none once expired', async () => {
    w = await boot(server, { user: null });
    const { supabase } = require('@/lib/supabase');
    supabase.auth.refreshSession.mockImplementation(async () => ({ data: { session: null }, error: { message: 'offline' } }));
    w.sb.setSession({ access_token: 'tok-old', expires_at: nowS() + 30, user: { id: 'u1' } } as any);
    expect(await require('@/lib/accessToken').accessToken()).toBe('tok-old');
    w.sb.setSession({ access_token: 'tok-dead', expires_at: nowS() - 10, user: { id: 'u1' } } as any);
    expect(await require('@/lib/accessToken').accessToken()).toBeNull();
  });
});

describe('who the server learns the user from', () => {
  it('publish signed in: Authorization: Bearer <token>, and no userId in the body', async () => {
    w = await boot(server, { user: 'u1' });
    await w.m.siteStore.saveSite(draft());
    w.willBuy(P.websiteMonthly);
    expect(await publish()).toMatchObject({ kind: 'live' });
    const call = server.calls.find((c) => c.path === '/api/ios/publish')!;
    expect(call.headers?.Authorization).toBe('Bearer tok-u1');
    expect(call.body.userId).toBeUndefined();
  });

  it('publish signed out: the request is never sent (the server would answer 401); the account step comes first', async () => {
    w = await boot(server, { user: null });
    await w.m.siteStore.saveSite(draft());
    w.willBuy(P.websiteMonthly);
    expect(await publish()).toEqual({ kind: 'claim-required' });
    expect(server.calls.find((c) => c.path === '/api/ios/publish')).toBeUndefined();
  });

  it('a session that cannot be refreshed and has expired sends nothing: back to the account step with the record kept', async () => {
    w = await boot(server, { user: null });
    const { supabase } = require('@/lib/supabase');
    supabase.auth.refreshSession.mockImplementation(async () => ({ data: { session: null }, error: { message: 'offline' } }));
    w.sb.setSession({ access_token: 'tok-dead', expires_at: nowS() - 10, user: { id: 'u1' } } as any);
    await w.m.siteStore.saveSite(draft());
    w.willBuy(P.websiteMonthly);
    expect(await publish()).toEqual({ kind: 'claim-required' });
    expect(server.count('/api/ios/publish')).toBe(0);
    expect(await w.pending()).toMatchObject({ state: 'unclaimed' });
  });

  it('every /api/ios/site request carries the Bearer (restore, admin sync, status check)', async () => {
    w = await boot(server, { user: 'u1' });
    await w.m.siteStore.saveSite(draft());
    w.willBuy(P.websiteMonthly);
    await publish();
    await drain();
    await w.restore();
    w.m.adminSync.resetSyncState();
    await w.m.adminSync.syncQuietly();
    const sites = server.calls.filter((c) => c.path === '/api/ios/site');
    expect(sites.length).toBeGreaterThan(0);
    for (const c of sites) expect(c.headers?.Authorization).toBe('Bearer tok-u1');
  });

  it('signed out, /api/ios/site is never requested at all', async () => {
    w = await boot(server, { user: null });
    await w.m.siteStore.saveSite(draft({ slug: 'fade-lab', transactionId: 'tx-1', deployedUrl: 'https://fade-lab.aibarber.org' }));
    w.m.adminSync.resetSyncState();
    await w.m.adminSync.syncQuietly();
    expect(server.count('/api/ios/site')).toBe(0);
  });

  it('publish with a session about to expire sends the refreshed token', async () => {
    w = await boot(server, { user: null });
    const { supabase } = require('@/lib/supabase');
    w.sb.setSession({ access_token: 'tok-old', expires_at: nowS() + 20, user: { id: 'u1' } } as any);
    supabase.auth.refreshSession.mockImplementation(async () => ({ data: { session: { access_token: 'tok-new', user: { id: 'u1' } } }, error: null }));
    await w.m.siteStore.saveSite(draft());
    w.willBuy(P.websiteMonthly);
    await publish();
    expect(server.calls.find((c) => c.path === '/api/ios/publish')?.headers?.Authorization).toBe('Bearer tok-new');
  });

  it('the plan refresh after publish, shop setup and the domain claim send the bearer', async () => {
    w = await boot(server, { user: 'u1' });
    await w.m.siteStore.saveSite(draft());
    w.willBuy(P.websiteMonthly);
    await publish();
    await drain();
    expect(server.calls.find((c) => c.path === '/api/shop/plan')?.headers?.Authorization).toBe('Bearer tok-u1');
    const { shopSetup, buildSetupBody } = require('@/lib/setup/ownerApi');
    await shopSetup(buildSetupBody((await w.site())!));
    expect(server.calls.find((c) => c.path === '/api/shop/setup')?.headers?.Authorization).toBe('Bearer tok-u1');
    server.buy(DOMAIN_PRODUCT);
    const { sendClaim } = require('@/lib/domains/resume');
    await sendClaim({ transactionId: 'tx-2', siteTransactionId: 'tx-1', domain: 'fadelab.com' });
    expect(server.calls.find((c) => c.path === '/api/ios/domain/claim')?.headers?.Authorization).toBe('Bearer tok-u1');
  });
});
