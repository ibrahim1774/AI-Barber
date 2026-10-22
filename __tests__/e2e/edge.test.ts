/**
 * Edge cases: very long text, emoji, RTL and zero-width characters through a
 * real publish and an admin round trip; malformed server copies; prices and
 * currency formatting; and the paywall copy rule (never a yearly price shown
 * as a monthly figure) over all the app's source.
 */
jest.mock('expo-superwall', () => require('./mocks').superwallMock());
jest.mock('expo-sqlite/kv-store', () => require('./mocks').diskMock());

import fs from 'fs';
import path from 'path';
import { Alert } from 'react-native';
import { FakeServer, P, boot, draft, installFetch, siteData, type World } from './harness';
import { wipeDisk } from './mocks';

let server: FakeServer;
let w: World;

beforeEach(async () => {
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

async function publish(world: World) {
  const site = await world.m.siteStore.loadSite();
  return world.m.publish.publishFlow(site!, world.deps);
}

const RTL_NAME = 'صالون الملك ✂️ Barber';
const FAMILY = '👨‍👩‍👧‍👦'; // ZWJ sequence
const FLAG = '🇺🇸';
const LONG = 'Fresh fades and hot towel shaves. '.repeat(400); // ~13.6k chars

describe('text that is long, emoji or right-to-left', () => {
  it('reaches the server exactly as typed (no marker or zero-width damage), and comes back on restore', async () => {
    w = await boot(server, { user: 'u1' });
    const data = siteData({
      shopName: RTL_NAME,
      area: `‫Queens‬ ${FLAG}`,
      hero: { heading: `${FAMILY} Family cuts`, tagline: 'נִיסָּיוֹן 10 שנים', imageUrl: '' },
      about: { heading: 'About', description: [LONG, `Line with zero width joiner: a‍b and nbsp here`], imageUrl: '' },
      services: [{ title: 'Kids cut 👦🏽', price: '$25', description: 'x'.repeat(2000), imageUrl: '' }],
    });
    await w.m.siteStore.saveSite(draft({ data, inputs: { ...draft().inputs, shopName: RTL_NAME } }));
    w.willBuy(P.websiteMonthly);
    expect(await publish(w)).toMatchObject({ kind: 'live' });
    const sent = server.published[0];
    expect(sent.shopName).toBe(RTL_NAME);
    expect(sent.area).toBe(`‫Queens‬ ${FLAG}`);
    expect(sent.hero.heading).toBe(`${FAMILY} Family cuts`);
    expect(sent.about.description[0]).toBe(LONG);
    expect(sent.about.description[1]).toContain('a‍b');
    expect(sent.services[0].title).toBe('Kids cut 👦🏽');
    // The server's slug from an RTL + emoji name: still a usable site id.
    expect(server.boundSiteId).toMatch(/^[a-z0-9-]+$/);
    // Restore on a new phone brings the same text back.
    w.unmount();
    jest.resetModules();
    wipeDisk();
    w = await boot(server, { user: null });
    const restored = await w.restore();
    expect(restored.site.data.shopName).toBe(RTL_NAME);
    expect(restored.site.inputs.shopName).toBe(RTL_NAME);
  });

  it('an admin edit with emoji / RTL is adopted intact', async () => {
    w = await boot(server, { user: 'u1' });
    await w.m.siteStore.saveSite(draft());
    w.willBuy(P.websiteMonthly);
    await publish(w);
    w.m.adminSync.resetSyncState();
    server.adminEdit((d) => ({ ...d, shopName: RTL_NAME, hero: { ...d.hero, tagline: FAMILY } }));
    await w.m.adminSync.syncQuietly();
    const rec = await w.site();
    expect(rec?.data.shopName).toBe(RTL_NAME);
    expect(rec?.inputs.shopName).toBe(RTL_NAME);
    expect(rec?.data.hero.tagline).toBe(FAMILY);
  });

  it('a text that happens to start with "Data:" is blanked by the payload cleaner (it guards against inline images)', () => {
    const { publishPayload } = require('@/lib/publish');
    const out = publishPayload(siteData({ about: { heading: 'About', description: ['Data: we track every cut.'], imageUrl: '' } }));
    // Recorded as observed behaviour: case-insensitive match on any string, not only image slots.
    expect(out.about.description[0]).toBe('');
  });

  // BUG (low): shortLink cuts at 33 UTF-16 units, which can split an emoji into a lone surrogate.
  it.failing('BUG: shortLink never splits an emoji (no lone surrogate in the Book-button picker)', () => {
    const { shortLink } = require('@/lib/bookingChoice');
    const url = `https://booksy.com/${'a'.repeat(21)}💈💈`; // the cut lands inside the first 💈
    const s: string = shortLink(url);
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(s)).toBe(false);
  });
});

describe('malformed server copies', () => {
  async function live() {
    w = await boot(server, { user: 'u1' });
    await w.m.siteStore.saveSite(draft());
    w.willBuy(P.websiteMonthly);
    await publish(w);
    w.m.adminSync.resetSyncState();
  }

  it('GET /api/ios/site as an HTML 504 page: sync is silent, nothing changes', async () => {
    await live();
    const before = await w.site();
    server.fail('/api/ios/site', { kind: 'html', status: 504 });
    expect(await w.m.adminSync.syncQuietly()).toEqual({ kind: 'none' });
    expect(await w.site()).toEqual(before);
  });

  it('GET /api/ios/site with missing fields / a version as a string: nothing adopted, nothing learned', async () => {
    await live();
    const before = await w.site();
    server.fail('/api/ios/site', { kind: 'json', status: 200, body: { siteId: 'fade-lab', version: '9', editedBy: 'admin', siteData: siteData({ shopName: 'X' }) } });
    expect(await w.m.adminSync.syncQuietly()).toEqual({ kind: 'none' });
    expect(await w.site()).toEqual(before);
  });

  // BUG (low): a truthy non-object siteData is adopted as the site.
  it.failing('BUG: an admin copy whose siteData is a string is not adopted', async () => {
    await live();
    server.fail('/api/ios/site', { kind: 'json', status: 200, body: { siteId: 'fade-lab', deployedUrl: 'https://fade-lab.aibarber.org', version: 9, editedBy: 'admin', siteData: '<html>oops</html>' } });
    await w.m.adminSync.syncQuietly();
    expect(typeof (await w.site())?.data).toBe('object');
  });

  it('a 409 whose body copy has no siteData falls back to the fetch', async () => {
    await live();
    server.adminEdit((d) => ({ ...d, area: 'Harlem' }));
    server.fail('/api/ios/site', { kind: 'json', status: 200, body: { siteId: 'fade-lab' } }); // the pre-publish sync sees nothing
    server.fail('/api/ios/publish', { kind: 'json', status: 409, body: { error: 'site-updated', site: { version: 2 } } });
    const out = await publish(w);
    expect(out.kind).toBe('site-updated');
    expect((await w.site())?.data.area).toBe('Harlem');
  });
});

describe('prices and currency formatting', () => {
  const { formatMoney } = require('@/lib/bookings/calendar');
  const { centsToPrice, parsePriceCents } = require('@/lib/setup/servicesMap');
  const { formatPrice, parsePrice } = require('@/lib/store/productDraft');
  const { formatPrice: typedPrice } = require('@/lib/sections/services');

  it.each([
    [0, '$0'], [5, '$0.05'], [50, '$0.50'], [999, '$9.99'], [1000, '$10'], [1999, '$19.99'], [19199, '$191.99'],
  ])('formatMoney(%i) = %s, matching the product and setup formatters', (cents, text) => {
    expect(formatMoney(cents)).toBe(text);
    expect(formatPrice(cents)).toBe(text);
    expect(centsToPrice(cents)).toBe(text);
  });

  // BUG (cosmetic): formatMoney has no thousands separator; centsToPrice does. Shown in the refund
  // sheet ("Up to $1250"), order totals and booking prices next to "$1,250" elsewhere.
  it.failing('BUG: formatMoney(125000) is "$1,250" like centsToPrice', () => {
    expect(formatMoney(125000)).toBe(centsToPrice(125000));
  });

  it('typed prices round-trip: "$1,200.5" / "1200.50" / "From $25+"', () => {
    expect(typedPrice('$1,200.5')).toBe('$1,200.50');
    expect(typedPrice('1200.50')).toBe('$1,200.50');
    expect(parsePriceCents('From $25+')).toBe(2500);
    expect(parsePrice('1,200.50')).toBe(120050);
    expect(parsePrice('1,2,0')).toBeNull();
    expect(parsePriceCents('€30')).toBeNull(); // a non-dollar import becomes "Ask", never a wrong dollar amount
    expect(formatMoney(null)).toBe('Ask');
  });

  it('floating point never shifts a cent', () => {
    for (let c = 0; c <= 100000; c += 7) expect(parsePrice(formatPrice(c))).toBe(c);
  });
});

describe('paywall copy rule: no monthly equivalent of a yearly price anywhere in app copy', () => {
  const root = path.join(__dirname, '../..');
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(tsx?|json)$/.test(e.name)) files.push(p);
    }
  };
  walk(path.join(root, 'src'));
  files.push(path.join(root, 'app.json'));

  const PER_MONTH = /\$\s?\d[\d,]*(?:\.\d{1,2})?\s*(?:\/|per|a|each)\s*(?:mo\b|mth|month)/i;
  // 191.99/12 = 16.00, 239.99/12 = 20.00, 379.99/12 = 31.67 (and the usual roundings).
  const DERIVED = /\$\s?(?:15\.99|16(?:\.00)?|19\.99\s*\/\s*mo|20\.00|31\.6[67]|31\.99|32(?:\.00)?)(?![\d.])/;
  const SAVINGS = /\bsave\s+\d+\s?%|\d+\s?%\s+off\b|billed (?:yearly|annually)/i;

  it('has files to scan', () => expect(files.length).toBeGreaterThan(100));

  it('no "$X/mo", "per month" price, derived monthly figure, or "save N%" in any source file', () => {
    const hits: string[] = [];
    for (const f of files) {
      const lines = fs.readFileSync(f, 'utf8').split('\n');
      lines.forEach((l, i) => {
        if (PER_MONTH.test(l) || DERIVED.test(l) || SAVINGS.test(l)) hits.push(`${path.relative(root, f)}:${i + 1}: ${l.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it('the scan would catch the forbidden forms', () => {
    for (const s of ['$16/mo', 'just $16.00 per month', '$31.67 a month', 'Save 20%', 'billed yearly', '$20.00']) {
      expect(PER_MONTH.test(s) || DERIVED.test(s) || SAVINGS.test(s)).toBe(true);
    }
    for (const s of ['$191.99', '$19.99', '$379.99', 'There is no monthly fee']) {
      expect(PER_MONTH.test(s) || DERIVED.test(s) || SAVINGS.test(s)).toBe(false);
    }
  });
});
