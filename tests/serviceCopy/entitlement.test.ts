// The live plan lookup of the service-copy endpoint: the same table, mode and statuses publish requires (web_app_entitlements).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const st = vi.hoisted(() => ({ calls: [] as string[], rows: [] as any[], fail: false }));
vi.mock('../../lib/webApp/webAppServer.js', () => ({
  webAppCors: () => false, webAppCheckoutOn: () => true, webAppEntitlementsOn: () => true, APP_ORIGIN: () => 'https://app.test',
  callerFrom: async () => ({ id: 'u' }),
  sbRest: async (path: string) => { st.calls.push(path); if (st.fail) throw new Error('db down'); return st.rows; },
  readRawBody: async () => '',
}));
vi.mock('../../lib/webApp/reliability.js', async (orig) => ({ ...(await orig<any>()), modeOf: () => 'test', reliabilityOn: () => true }));
import { liveDeps } from '../../lib/serviceCopy/handler';

beforeEach(() => { st.calls = []; st.rows = []; st.fail = false; });

describe('liveDeps().entitled', () => {
  it('no row -> not entitled; an active, trialing or past_due row -> entitled; any other status that slips through -> not entitled', async () => {
    const e = liveDeps().entitled;
    st.rows = []; expect(await e('u1')).toBe(false);
    for (const status of ['active', 'trialing', 'past_due']) { st.rows = [{ status }]; expect(await e('u1'), status).toBe(true); }
    for (const status of ['canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused', '']) { st.rows = [{ status }]; expect(await e('u1'), status).toBe(false); }
    st.rows = null as any; expect(await e('u1')).toBe(false);
  });
  it('queries the current Stripe mode and only entitled statuses, for the caller only', async () => {
    st.rows = [{ status: 'active' }];
    await liveDeps().entitled('a b');
    expect(st.calls[0]).toContain('web_app_entitlements?user_id=eq.a%20b');
    expect(st.calls[0]).toContain('environment=eq.test');
    expect(st.calls[0]).toContain('status=in.(active,trialing,past_due)');
  });
  it('a failed lookup throws (the handler turns it into 503 and makes no call)', async () => {
    st.fail = true;
    await expect(liveDeps().entitled('u1')).rejects.toThrow();
  });
  it('autoPublish follows the environment variable per call', () => {
    delete process.env.SERVICE_COPY_AUTO_PUBLISH;
    expect(liveDeps().autoPublish()).toBe(false);
    process.env.SERVICE_COPY_AUTO_PUBLISH = '1';
    try { expect(liveDeps().autoPublish()).toBe(true); } finally { delete process.env.SERVICE_COPY_AUTO_PUBLISH; }
  });
});
