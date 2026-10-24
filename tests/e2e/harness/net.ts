// The only network the e2e suite has. Global fetch is replaced: *.vercel.app serves what the fake
// Vercel deployed, api.vercel.com answers project lookups, api.stripe.com is the fake Stripe, and
// EVERY other host throws, so nothing can ever reach production (aibarber.org, Supabase, Apple...).
import { vi } from 'vitest';
import { handleStripe } from './stripe.js';
import { vercel } from './vercel.js';

export const net = { calls: [] as string[], blocked: [] as string[] };

const resp = (status: number, body: string, type = 'text/html') => ({
  ok: status >= 200 && status < 300,
  status,
  headers: new Map([['content-type', type]]),
  text: async () => body,
  json: async () => JSON.parse(body),
});

export async function fakeFetch(input: any, init: any = {}) {
  const href = typeof input === 'string' ? input : input?.url ?? String(input);
  net.calls.push(href);
  const url = new URL(href);
  const host = url.hostname.toLowerCase();
  if (host.endsWith('.vercel.app')) {
    const label = host.slice(0, -'.vercel.app'.length);
    const html = vercel.live.get(label);
    return html != null ? resp(200, html) : resp(404, 'DEPLOYMENT_NOT_FOUND');
  }
  if (host === 'api.vercel.com') {
    const m = /^\/v\d+\/projects\/([^/]+)$/.exec(url.pathname);
    if (m) {
      const name = decodeURIComponent(m[1]);
      return vercel.projects.has(name) || vercel.live.has(name) ? resp(200, '{}', 'application/json') : resp(404, '{}', 'application/json');
    }
  }
  if (host === 'api.stripe.com') {
    return handleStripe(url, { method: init.method || 'GET', headers: init.headers || {}, body: init.body });
  }
  net.blocked.push(href);
  throw new Error(`e2e: blocked network call to ${href}`);
}

/** Stub fetch and set dummy (never real) credentials. Call in beforeEach. */
export function installNetwork() {
  net.calls.length = 0;
  net.blocked.length = 0;
  vi.stubGlobal('fetch', vi.fn(fakeFetch));
  vi.stubEnv('GCS_BUCKET_NAME', 'e2e-bucket');
  vi.stubEnv('GCP_SERVICE_ACCOUNT_JSON', JSON.stringify({ project_id: 'e2e', client_email: 'e2e@example.invalid', private_key: 'none' }));
  vi.stubEnv('GCS_CREDENTIALS', '');
  vi.stubEnv('STRIPE_CONNECT_SECRET_KEY', 'sk_test_e2e_fake');
  vi.stubEnv('VERCEL_TOKEN', 'e2e-fake-token');
  // No Supabase: anything that reaches for a real client fails loudly instead of calling out.
  vi.stubEnv('SUPABASE_URL', 'http://supabase.e2e.invalid');
  vi.stubEnv('VITE_SUPABASE_URL', '');
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'e2e-fake');
  vi.stubEnv('BOOKING_BASE_URL', '');
  vi.stubEnv('APPLE_BUNDLE_ID', 'com.ibrahim1774.aibarber');
  vi.stubEnv('IOS_TAKEDOWN_SANDBOX', '');
  vi.stubEnv('CRON_SECRET', 'e2e-cron-secret');
}
