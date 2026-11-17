import { describe, it, expect, vi, afterEach } from 'vitest';

const ps = vi.hoisted(() => ({ publishSite: vi.fn(async () => ({ ok: true, siteId: 's' })) }));
vi.mock('../lib/publishSite.js', async (orig) => ({ ...(await orig<object>()), publishSite: ps.publishSite }));

import { liveDeps } from '../lib/ios/publishFlow.js';
import { liveWebPublishDeps } from '../lib/webApp/publishFlow.js';

afterEach(() => vi.unstubAllEnvs());

describe('owner publish flows tell publishSite they are the owner (so the removed-site guard lets them through)', () => {
  it('iOS owner publish', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://x.supabase.co'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'k');
    await liveDeps().publish('s', { force: true });
    expect((ps.publishSite.mock.calls.at(-1) as any)[1].ownerPublish).toBe(true);
  });
  it('web owner publish', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://x.supabase.co'); vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'k'); vi.stubEnv('STRIPE_WEBAPP_SECRET_KEY', 'sk_test_x');
    await liveWebPublishDeps().publish('s', { force: true });
    expect((ps.publishSite.mock.calls.at(-1) as any)[1].ownerPublish).toBe(true);
  });
});
