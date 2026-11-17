// The forced-cancel delete (a two-site account through the Apple route, or a web account while the account route does not exist) runs the REAL liveWebDeleteDeps path:
// with Stripe down and Stripe history it fails closed (500, nothing deleted); with no Stripe history it proceeds.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ tables: {} as Record<string, any[]> }));
const stripe = vi.hoisted(() => ({ fn: null as any }));
const probe = vi.hoisted(() => ({ closed: 0, deleted: 0, alerts: 0 }));
vi.mock('../../lib/webApp/webAppServer.js', () => ({
  sbRest: vi.fn(async (p: string) => db.tables[p.split('?')[0]] ?? []),
  stripeCall: vi.fn((...a: any[]) => stripe.fn(...a)),
}));
vi.mock('../../lib/ios/deleteAccount.js', async (orig) => ({
  ...(await orig<typeof import('../../lib/ios/deleteAccount.js')>()),
  liveDeleteDeps: () => ({
    getUser: async () => ({ id: 'u1' }), closeShop: async () => { probe.closed++; return { ok: true, bookingsCancelled: 0, ordersCancelled: 0, needsRefund: [], notCancelled: [] }; },
    listSites: async () => [], takeDown: async () => {}, purge: async () => {}, deleteUser: async () => { probe.deleted++; }, deleteSites: async () => {},
  }),
}));
vi.mock('../../lib/ios/removeSiteLive.js', () => ({ liveRemoveDeps: () => ({}) }));
vi.mock('../../lib/webApp/reliability.js', () => ({ suspendWork: async () => {}, markSiteOffline: async () => {}, resumeAfterFailedDelete: async () => {}, reliabilityOn: () => false, enc: encodeURIComponent, draftPath: () => '' }));
vi.mock('../../lib/webApp/userExists.js', () => ({ emailOfUser: async () => 'a@example.com' }));
vi.mock('../../lib/webApp/emails.js', async (orig) => ({ ...(await orig<typeof import('../../lib/webApp/emails.js')>()), alertOwner: async () => { probe.alerts++; } }));

import { deleteAccount } from '../../lib/ios/deleteAccount.js';
import { liveWebDeleteDeps } from '../../lib/webApp/deleteAccount.js';

beforeEach(() => { db.tables = {}; Object.assign(probe, { closed: 0, deleted: 0, alerts: 0 }); stripe.fn = async () => { throw new Error('stripe down'); }; vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x'); vi.spyOn(console, 'error').mockImplementation(() => {}); });
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const run = () => deleteAccount('Bearer t', liveWebDeleteDeps({ allowNoStripe: true }));

describe('forced-cancel delete with Stripe down', () => {
  it('a two-site account WITH Stripe history fails closed: 500 delete-failed (retryable), the shop is not closed, nothing is deleted', async () => {
    db.tables = { web_app_entitlements: [{ user_id: 'u1' }], ios_purchases: [{ original_transaction_id: 'o1' }] };
    const r = await run();
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ error: 'delete-failed', retryable: true });
    expect(probe.closed).toBe(0); expect(probe.deleted).toBe(0);
  });
  it('with NO Stripe history the delete proceeds (and the owner is alerted)', async () => {
    db.tables = { ios_purchases: [{ original_transaction_id: 'o1' }] };
    const r = await run();
    expect(r.status).toBe(200);
    expect(probe.deleted).toBe(1);
    expect(probe.alerts).toBeGreaterThan(0);
  });
});
