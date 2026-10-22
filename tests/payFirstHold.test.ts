// /custom-15 pay-first hold: after payment the sample site ("Premium Cuts")
// must not go public until the barber enters a shop name and a phone or a
// booking link. publishSite, the Stripe webhook and the sweeper all hold it.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const store = new Map<string, string>();

vi.mock('@google-cloud/storage', () => ({
  Storage: class {
    bucket() {
      return {
        file: (name: string) => ({
          exists: async () => [store.has(name)],
          download: async () => [Buffer.from(store.get(name) ?? '')],
          save: async (data: string) => { store.set(name, data); },
        }),
      };
    }
  },
}));

const deployRenderedSite = vi.fn(async (_args: any) => ({ deploymentUrl: 'https://x.vercel.app', uploadedImages: {} }));
vi.mock('../lib/deploySite.js', () => ({ deployRenderedSite: (a: any) => deployRenderedSite(a) }));
// A web site: no shop behind the slug (lib/siteSubpages.ts; a lookup error would fail the publish).
vi.mock('../lib/siteSubpages.js', async (orig) => ({ ...(await orig<object>()), findShopForSite: async () => null }));

import { publishSite, writePendingSite } from '../lib/publishSite.js';
import { httpImageUrlMap, isAwaitingDetails, isPayFirstPlan, validatePayFirstDetails } from '../lib/payFirst';

const read = (p: string) => readFileSync(join(__dirname, '..', p), 'utf8');

const sample = (extra: any = {}): any => ({
  siteId: 'premium-cuts',
  siteData: {
    template: 'luxe',
    shopName: 'Premium Cuts',
    area: '',
    phone: '',
    hero: { heading: 'Premium Cuts', tagline: 'Book your next visit.', imageUrl: 'uploaded' },
    about: { heading: 'About the Shop', description: ['x'], imageUrl: 'uploaded' },
    services: [],
    contact: { address: '', email: '' },
    gallery: [],
    craftImages: [],
    staff: [],
    ...extra,
  },
  imageUrlMap: { hero: 'https://img/h.jpg' },
});

const notLive = () => vi.fn(async () => new Response('Not found', { status: 404 }));

beforeEach(() => {
  store.clear();
  deployRenderedSite.mockClear();
  process.env.GCS_BUCKET_NAME = 'b';
  process.env.GCS_CREDENTIALS = JSON.stringify({ project_id: 'p' });
  vi.stubGlobal('fetch', notLive());
});

describe('lib/payFirst', () => {
  it('pay-first plans', () => {
    expect(isPayFirstPlan('monthly-custom15')).toBe(true);
    expect(isPayFirstPlan('monthly-custom10')).toBe(true);
    expect(isPayFirstPlan('monthly')).toBe(false);
    expect(isPayFirstPlan(undefined)).toBe(false);
  });

  it('isAwaitingDetails: the flag, or a pay-first plan without confirmed details', () => {
    expect(isAwaitingDetails({ awaitingDetails: true })).toBe(true);
    expect(isAwaitingDetails({ awaitingDetails: true }, 'monthly')).toBe(true);
    expect(isAwaitingDetails({}, 'monthly-custom15')).toBe(true); // stale bundle wrote no flag
    expect(isAwaitingDetails({ detailsConfirmed: true }, 'monthly-custom15')).toBe(false);
    expect(isAwaitingDetails({}, 'monthly')).toBe(false);
    expect(isAwaitingDetails({})).toBe(false);
  });

  it('validatePayFirstDetails: name + (phone with digits | booking link)', () => {
    expect(validatePayFirstDetails({ shopName: '', phone: '5125550100' })).toMatch(/shop name/);
    expect(validatePayFirstDetails({ shopName: 'Kings', phone: '', bookingUrl: '' })).toMatch(/phone number or a booking link/);
    expect(validatePayFirstDetails({ shopName: 'Kings', phone: 'call us' })).toMatch(/phone number or a booking link/);
    expect(validatePayFirstDetails({ shopName: 'Kings', phone: '(512) 555-0100' })).toBeNull();
    expect(validatePayFirstDetails({ shopName: 'Kings', bookingUrl: 'booksy.com/x' })).toBeNull();
  });

  it('httpImageUrlMap maps hotlinked images only', () => {
    const map = httpImageUrlMap({
      hero: { imageUrl: 'https://a/h.jpg' }, about: { imageUrl: '' }, gallery: ['https://a/g0.jpg', '', 'data:x'],
      craftImages: ['https://a/c.jpg'], staff: [{ name: 'Jo', photo: 'https://a/s.jpg' }],
    } as any);
    expect(map).toEqual({ hero: 'https://a/h.jpg', gallery0: 'https://a/g0.jpg', craft0: 'https://a/c.jpg', staff0: 'https://a/s.jpg' });
  });
});

describe('publishSite holds a pay-first site awaiting details', () => {
  it('flagged copy → not published (even with force), reason awaiting-details', async () => {
    await writePendingSite('premium-cuts', sample({ awaitingDetails: true }));
    for (const opts of [{}, { force: true }, { plan: 'monthly-custom15' }]) {
      const out = await publishSite('premium-cuts', opts as any);
      expect(out.ok).toBe(false);
      expect(out.reason).toBe('awaiting-details');
    }
    expect(deployRenderedSite).not.toHaveBeenCalled();
  });

  it('pay-first plan + unconfirmed copy written by a stale bundle → held', async () => {
    await writePendingSite('premium-cuts', sample());
    const out = await publishSite('premium-cuts', { plan: 'monthly-custom15' });
    expect(out.reason).toBe('awaiting-details');
    expect(deployRenderedSite).not.toHaveBeenCalled();
  });

  it('confirmed details → publishes (so the sweeper can finish if the tab dies mid-deploy)', async () => {
    await writePendingSite('kings-cuts', sample({ siteId: 'kings-cuts', shopName: 'Kings Cuts', phone: '512 555 0100', detailsConfirmed: true }));
    const out = await publishSite('kings-cuts', { plan: 'monthly-custom15' });
    expect(out.ok).toBe(true);
    expect(deployRenderedSite).toHaveBeenCalledTimes(1);
  });

  it('ordinary plans are unaffected', async () => {
    await writePendingSite('fresh-cuts', sample({ shopName: 'Fresh Cuts', phone: '1' }));
    const out = await publishSite('fresh-cuts', { plan: 'monthly' });
    expect(out.ok).toBe(true);
  });
});

describe('the webhook and the sweeper pass the checkout plan', () => {
  it('api/stripe-webhook', () => {
    expect(read('api/stripe-webhook.ts')).toMatch(/publishSite\(siteId, \{ plan[^}]*\}\)/);
  });
  it('api/publish-sweeper', () => {
    expect(read('api/publish-sweeper.ts')).toMatch(/publishSite\(siteId, \{ plan: [^}]*\}\)/);
  });
});

describe('sweeper end to end: a paid /custom-15 session awaiting details is skipped', () => {
  it('lists the session, does not deploy, reports awaiting-details', async () => {
    await writePendingSite('premium-cuts', sample({ awaitingDetails: true }));
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).startsWith('https://api.stripe.com/v1/checkout/sessions')) {
        return new Response(JSON.stringify({
          data: [{ id: 'cs_1', payment_status: 'paid', metadata: { app: 'aibarber', siteId: 'premium-cuts', plan: 'monthly-custom15' } }],
          has_more: false,
        }), { status: 200 });
      }
      return new Response('Not found', { status: 404 });
    }));
    process.env.STRIPE_SECRET_KEY = 'sk_test';
    process.env.CRON_SECRET = 'c';
    const { default: sweeper } = await import('../api/publish-sweeper');
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await sweeper({ headers: { authorization: 'Bearer c' }, query: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0][0];
    expect(body.repaired).toEqual([]);
    expect(body.skipped).toEqual([{ siteId: 'premium-cuts', reason: 'awaiting-details' }]);
    expect(deployRenderedSite).not.toHaveBeenCalled();
  });
});

describe('browser: details step before the first deploy (source checks; node env cannot render React)', () => {
  it('editors flag the pre-checkout copy for pay-first plans', () => {
    for (const f of ['components/GeneratedWebsite.tsx', 'components/PrimeWebsite.tsx', 'components/EuphoriaWebsite.tsx']) {
      expect(read(f), f).toMatch(/isPayFirstPlan\(String\(plan\)\) \? \{ awaitingDetails: true \} : \{\}/);
    }
  });

  it('App gates the Stripe return on isAwaitingDetails and resumes with the same session id', () => {
    const app = read('App.tsx');
    expect(app).toContain('beginStripeReturn(stripeSessionId, stripePlan)');
    expect(app).toMatch(/isAwaitingDetails\(pending\?\.siteData, plan\)/);
    expect(app).toContain('<PayFirstDetailsStep');
    expect(app).toMatch(/handleStripeReturn\(gate\.sessionId, gate\.plan\)/);
  });

  it('the details step requires name + phone or booking link, scrapes a link, else generateContent with the checklist', () => {
    const src = read('components/PayFirstDetailsStep.tsx');
    for (const s of ['validatePayFirstDetails', "fetch('/api/import-scrape'", 'buildSiteFromScrape', 'generateContent', '<ServiceChecklist', 'collapsible', 'detailsConfirmed: true', "'/api/save-pending-site'"]) {
      expect(src, s).toContain(s);
    }
    expect(src).not.toContain('Premium Cuts');
  });
});
