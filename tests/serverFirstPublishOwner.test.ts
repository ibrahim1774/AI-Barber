import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { Readable } from 'node:stream';

// The webhook / sweeper did the first publish (the buyer's tab died): the owner is recorded as the
// browser path would have (a pending claim by the checkout email), on the slug actually published,
// including a /custom-15 pay-first site moved to its real slug at the details step.

const gcs = vi.hoisted(() => ({ objects: new Map<string, { data: string; gen: number }>(), gen: 0 }));
vi.mock('@google-cloud/storage', () => {
  const nf = () => Object.assign(new Error('not found'), { code: 404 });
  class Storage {
    bucket() {
      return {
        file: (name: string, o: { generation?: number } = {}) => ({
          exists: async () => [gcs.objects.has(name)],
          getMetadata: async () => { const x = gcs.objects.get(name); if (!x) throw nf(); return [{ generation: String(x.gen) }]; },
          download: async () => {
            const x = gcs.objects.get(name);
            if (!x || (o.generation != null && String(o.generation) !== String(x.gen))) throw nf();
            return [Buffer.from(x.data)];
          },
          save: async (data: string, opts: any = {}) => {
            const want = opts?.preconditionOpts?.ifGenerationMatch;
            if (want != null && String(gcs.objects.get(name)?.gen ?? 0) !== String(want)) throw Object.assign(new Error('pre'), { code: 412 });
            gcs.objects.set(name, { data, gen: ++gcs.gen });
          },
        }),
      };
    }
  }
  return { Storage, default: { Storage } };
});
const deployed = vi.hoisted(() => [] as string[]);
vi.mock('../lib/deploySite.js', () => ({
  deployRenderedSite: async (i: { siteId: string }) => { deployed.push(i.siteId); return { deploymentUrl: `https://${i.siteId}.vercel.app`, uploadedImages: {} }; },
}));
const projects = vi.hoisted(() => new Set<string>());
vi.mock('../lib/ios/slug.js', async (orig) => ({ ...(await orig<object>()), vercelProjectExists: async (s: string) => projects.has(s) }));
vi.mock('../lib/siteSubpages.js', async (orig) => ({ ...(await orig<object>()), findShopForSite: async () => null }));
const owners = vi.hoisted(() => ({ rows: new Map<string, any>() }));
vi.mock('../lib/siteOwners.js', async (orig) => {
  const real: any = await orig();
  const store = {
    get: async (s: string) => owners.rows.get(s) ?? null,
    insertIfAbsent: async (r: any) => (owners.rows.has(r.slug) ? false : (owners.rows.set(r.slug, { ...r }), true)),
    claim: async () => false, upsert: async () => {},
  };
  return { ...real, supabaseSiteOwners: () => store };
});
const waits = vi.hoisted(() => [] as Promise<unknown>[]);
vi.mock('@vercel/functions', () => ({ waitUntil: (p: Promise<unknown>) => { waits.push(p); } }));
vi.mock('../api/_twOrder.js', () => ({ pushOrderToTripleWhale: async () => ({ ok: true }) }));

import { writePendingSite } from '../lib/publishSite.js';
import { recordServerFirstPublishOwner } from '../lib/siteOwners.js';

const site = (shopName: string, extra: Record<string, unknown> = {}) => ({
  siteId: 'x',
  siteData: {
    template: 'luxe', shopName, area: 'Austin', phone: '555-0100',
    hero: { heading: shopName, tagline: 'T', imageUrl: '' }, about: { heading: 'A', description: ['d'], imageUrl: '' },
    services: [{ title: 'Fade', subtitle: '', description: 'x', icon: 'scissors', imageUrl: '' }],
    contact: { address: '1 Main St', email: 'a@b.co' }, gallery: [], craftImages: [], staff: [], ...extra,
  },
  imageUrlMap: {},
}) as any;
const session = (siteId: string, plan = 'monthly', over: Record<string, unknown> = {}) => ({
  id: `cs_test_${siteId}`, object: 'checkout.session', mode: 'subscription', status: 'complete', payment_status: 'paid',
  metadata: { app: 'aibarber', siteId, plan }, customer_details: { email: 'Buyer@Example.com', name: 'Sam Lee' },
  amount_total: 1500, currency: 'usd', ...over,
});

beforeEach(() => {
  gcs.objects.clear();
  deployed.length = 0;
  owners.rows.clear();
  projects.clear();
  waits.length = 0;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  process.env.GCS_BUCKET_NAME = 'b';
  process.env.GCS_CREDENTIALS = JSON.stringify({ project_id: 'p' });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

/** Stripe's list for the sweeper; every *.vercel.app is not live yet (404); FB / TikTok accept. */
function network(sessions: unknown[]) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url);
    if (u.startsWith('https://api.stripe.com/v1/checkout/sessions')) return new Response(JSON.stringify({ data: sessions, has_more: false }), { status: 200 });
    if (u.includes('vercel.app')) return new Response('Not found', { status: 404 });
    return new Response('{}', { status: 200 });
  }));
}

describe('publish-sweeper: first publish by the server records the owner', () => {
  const run = async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test';
    process.env.CRON_SECRET = 'c';
    const { default: sweeper } = await import('../api/publish-sweeper');
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await sweeper({ headers: { authorization: 'Bearer c' }, query: {} }, res);
    return res.json.mock.calls[0][0];
  };

  it('a regular site: published at its slug, pending claim by the checkout email', async () => {
    await writePendingSite('fresh-cuts', site('Fresh Cuts'));
    network([session('fresh-cuts')]);
    expect((await run()).repaired).toEqual([{ siteId: 'fresh-cuts', url: 'https://fresh-cuts.vercel.app' }]);
    expect(owners.rows.get('fresh-cuts')).toMatchObject({ user_id: null, claim_email: 'buyer@example.com', source: 'checkout', checkout_session_id: 'cs_test_fresh-cuts' });
  });

  it('pay-first: published at the details step\'s slug, and the owner row is on THAT slug', async () => {
    await writePendingSite('premium-cuts-k3m9p2xq', { ...site('Premium Cuts', { awaitingDetails: true }), movedTo: 'jacks-cuts-x7k2' });
    await writePendingSite('jacks-cuts-x7k2', { ...site('Jacks Cuts', { detailsConfirmed: true }), movedFrom: 'premium-cuts-k3m9p2xq' });
    network([session('premium-cuts-k3m9p2xq', 'monthly-custom15')]);
    expect((await run()).repaired).toEqual([{ siteId: 'jacks-cuts-x7k2', url: 'https://jacks-cuts-x7k2.vercel.app' }]);
    expect(deployed).toEqual(['jacks-cuts-x7k2']);
    expect(owners.rows.get('jacks-cuts-x7k2')).toMatchObject({ claim_email: 'buyer@example.com', user_id: null });
  });

  it('B1: a slug that already has a Vercel project (unstamped copy) is redeployed but records no owner', async () => {
    projects.add('jacks-cuts');
    await writePendingSite('jacks-cuts', site('Jacks Cuts'));
    network([session('jacks-cuts')]);
    expect((await run()).repaired).toEqual([{ siteId: 'jacks-cuts', url: 'https://jacks-cuts.vercel.app' }]);
    expect(deployed).toEqual(['jacks-cuts']);
    expect(owners.rows.has('jacks-cuts')).toBe(false);
  });

  it('B1: a failed project lookup reports no first publish, so no owner is recorded', async () => {
    const slug = await import('../lib/ios/slug.js');
    vi.spyOn(slug, 'vercelProjectExists').mockRejectedValueOnce(new Error('vercel down'));
    await writePendingSite('fresh-cuts', site('Fresh Cuts'));
    network([session('fresh-cuts')]);
    await run();
    expect(owners.rows.has('fresh-cuts')).toBe(false);
  });

  it('nothing deployed (already live, held, or a site that was published before) records nothing; an existing owner is kept', async () => {
    await writePendingSite('stamped', { ...site('Stamped'), deployedUrl: 'https://stamped.vercel.app' });
    owners.rows.set('fresh-cuts', { slug: 'fresh-cuts', user_id: 'someone', claim_email: null, source: 'admin' });
    await writePendingSite('fresh-cuts', site('Fresh Cuts'));
    network([session('stamped'), session('fresh-cuts')]);
    await run();
    expect(owners.rows.has('stamped')).toBe(false);
    expect(owners.rows.get('fresh-cuts')).toMatchObject({ user_id: 'someone', source: 'admin' });
  });
});

describe('stripe-webhook: the delayed server publish records the owner on the published slug', () => {
  const deliver = async (s: unknown) => {
    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_t';
    process.env.FB_ACCESS_TOKEN = 'fb';
    process.env.FB_PIXEL_ID = '1';
    const { default: webhook } = await import('../api/stripe-webhook');
    const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: s } });
    const t = Math.floor(Date.now() / 1000);
    const sig = `t=${t},v1=${crypto.createHmac('sha256', 'whsec_t').update(`${t}.${body}`).digest('hex')}`;
    const req: any = Readable.from([Buffer.from(body)]);
    Object.assign(req, { method: 'POST', headers: { 'stripe-signature': sig } });
    const res: any = { statusCode: 0, status(c: number) { this.statusCode = c; return this; }, json(b: unknown) { this.body = b; return this; } };
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    await webhook(req, res);
    await vi.advanceTimersByTimeAsync(91_000);
    await Promise.all(waits);
    return res;
  };

  it('pay-first moved: the owner row lands on the real slug (the placeholder gets the payment-time claim)', async () => {
    await writePendingSite('premium-cuts-k3m9p2xq', { ...site('Premium Cuts', { awaitingDetails: true }), movedTo: 'jacks-cuts-x7k2' });
    await writePendingSite('jacks-cuts-x7k2', { ...site('Jacks Cuts', { detailsConfirmed: true }), movedFrom: 'premium-cuts-k3m9p2xq' });
    network([]);
    const res = await deliver(session('premium-cuts-k3m9p2xq', 'monthly-custom15'));
    expect(res.statusCode).toBe(200);
    expect(deployed).toEqual(['jacks-cuts-x7k2']);
    expect(owners.rows.get('jacks-cuts-x7k2')).toMatchObject({ user_id: null, claim_email: 'buyer@example.com', checkout_session_id: 'cs_test_premium-cuts-k3m9p2xq' });
  });

  it('a regular site whose tab died: the owner is recorded (claim by the checkout email)', async () => {
    await writePendingSite('fresh-cuts', site('Fresh Cuts'));
    network([]);
    await deliver(session('fresh-cuts'));
    expect(deployed).toEqual(['fresh-cuts']);
    expect(owners.rows.get('fresh-cuts')).toMatchObject({ claim_email: 'buyer@example.com', source: 'checkout' });
  });
});

describe('recordServerFirstPublishOwner', () => {
  it('only for a first publish of a site checkout', async () => {
    const store = { get: async () => null, insertIfAbsent: vi.fn(async () => true), claim: async () => false, upsert: async () => {} };
    const s = session('fresh-cuts');
    expect(await recordServerFirstPublishOwner({ ok: true, siteId: 'fresh-cuts', firstPublish: false }, s, store)).toBeNull();
    expect(await recordServerFirstPublishOwner({ ok: true, siteId: 'fresh-cuts', firstPublish: true, alreadyLive: true }, s, store)).toBeNull();
    expect(await recordServerFirstPublishOwner({ ok: true, siteId: 'fresh-cuts', firstPublish: true }, { ...s, mode: 'payment' }, store)).toBeNull();
    expect(await recordServerFirstPublishOwner({ ok: true, siteId: 'fresh-cuts', firstPublish: true }, { ...s, metadata: { app: 'primehub' } }, store)).toBeNull();
    expect(store.insertIfAbsent).not.toHaveBeenCalled();
    expect(await recordServerFirstPublishOwner({ ok: true, siteId: 'fresh-cuts', firstPublish: true }, s, store)).toMatchObject({ claim_email: 'buyer@example.com' });
  });
});
