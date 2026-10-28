jest.mock('@/constants/theme', () => require('./store/themeMock'));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
import { DEFAULT_SWATCH } from '@/web/lib/brandSwatches';
import { generateContent } from '@/web/services/geminiService';
import type { TemplateId } from '@/web/types';
import { listingSite, manualSite, toShopSite } from '@/lib/importer';
import { startDraft } from '@/lib/flow';
import { scratchPicks } from '@/lib/scratchDefaults';
import { servicesFromPicks } from '@/lib/serviceChecklist';
import { bookingPrefs, bookTargetStatus, linksToSend, type LinkContext } from '@/lib/bookingChoice';
import { schedulerWarning } from '@/components/ButtonSheet';
import { renderSite } from '@/lib/render';
import { clearSite } from '@/lib/siteStore';

const booksy = require('./fixtures/scrape-booksy.json');
const OWN = 'https://booksy.com/en-us/1_fade-lab';
const DESIGNS: TemplateId[] = ['luxe', 'prime', 'euphoria'];

type Opt = 'link' | 'google' | 'scratch';
async function generate(opt: Opt, template: TemplateId) {
  if (opt === 'link') {
    const r = toShopSite({ ...booksy, bookingUrl: OWN }, OWN, 'booking');
    return { inputs: r.inputs, site: { ...r.site, template } };
  }
  if (opt === 'google') {
    const r = listingSite({ shopName: 'Fresh Cuts', area: 'Brooklyn, NY', phone: '555-0100', services: [] } as any, undefined);
    return { inputs: r.inputs, site: { ...r.site, template } };
  }
  const r = await manualSite({ shopName: 'Fresh Cuts', area: 'Brooklyn, NY', phone: '555-0100', address: '1 Main St', colorTheme: DEFAULT_SWATCH, services: servicesFromPicks(scratchPicks()) } as any);
  return { inputs: r.inputs, site: { ...r.site, template } };
}

beforeEach(() => clearSite());

describe.each(DESIGNS)('start options, design %s', (template) => {
  test.each(['google', 'scratch'] as Opt[])('option %s defaults to the built-in Book page', async (opt) => {
    const rec = await startDraft(await generate(opt, template));
    expect(rec.inputs.bookingChoice).toBe('aibarber');
    expect(rec.data.bookingUrl).toBe('/book');
    expect(bookingPrefs(rec)).toEqual({ own: null, choice: 'aibarber' });
    // The preview shows a real Book button that points at the built-in page.
    expect(renderSite(rec.data)).toContain('href="/book"');
  });

  test('option link keeps its own booking link as the default', async () => {
    const rec = await startDraft(await generate('link', template));
    expect(rec.data.bookingUrl).toBe(OWN);
    expect(rec.inputs.bookingChoice ?? 'own').toBe('own');
    expect(bookingPrefs(rec).choice).toBe('own');
    expect(renderSite(rec.data)).not.toContain('href="/book"');
  });

  test.each(['google', 'scratch'] as Opt[])('option %s: publish without a live Bookings plan carries no /book', async (opt) => {
    const rec = await startDraft(await generate(opt, template));
    const hostingOnly: LinkContext = {
      ents: { known: true, hosting: true, bookings: false, store: false }, shop: null, storeEnabled: false,
    };
    expect(linksToSend(rec.data, rec.inputs, hostingOnly).bookingUrl).toBeUndefined();
    // Bookings bought but no shop yet (the first publish): still no /book.
    expect(linksToSend(rec.data, rec.inputs, { ...hostingOnly, ents: { ...hostingOnly.ents, bookings: true } }).bookingUrl).toBeUndefined();
    // Lookup failed / signed out (ctx null), and entitlements unknown: fail closed, no /book.
    expect(linksToSend(rec.data, rec.inputs, null).bookingUrl).toBeUndefined();
    expect(linksToSend(rec.data, rec.inputs, { ...hostingOnly, ents: { known: false, hosting: false, bookings: false, store: false } }).bookingUrl).toBeUndefined();
    expect(linksToSend(rec.data, rec.inputs, { ...hostingOnly, ents: { known: true, hosting: false, bookings: true, store: false } }).bookingUrl).toBeUndefined();
    // Live scheduler: kept.
    const live: LinkContext = { ents: { ...hostingOnly.ents, bookings: true }, shop: { slug: 's', purchaseLinked: true, bookingsEnabled: true }, storeEnabled: false };
    expect(linksToSend(rec.data, rec.inputs, live).bookingUrl).toBe('/book');
  });
});

// The editor preview shows what a publish would send (linksToSend): the built-in /book (hero, header and contact Book
// buttons, the Book online section) only with a live Bookings scheduler. Before any plan none of it shows, for all
// three start options; a pasted own booking link keeps its button.
describe.each(DESIGNS)('preview before any Bookings plan, design %s', (template) => {
  const NONE: LinkContext = { ents: { known: true, hosting: false, bookings: false, store: false }, shop: null, storeEnabled: false };
  const unknown: LinkContext = { ents: { known: false, hosting: false, bookings: false, store: false }, shop: null, storeEnabled: false };
  const hostingOnly: LinkContext = { ents: { known: true, hosting: true, bookings: false, store: false }, shop: null, storeEnabled: false };
  test.each(['google', 'scratch'] as Opt[])('option %s: no /book, no Book online section', async (opt) => {
    const rec = await startDraft(await generate(opt, template));
    for (const ctx of [null, NONE, unknown, hostingOnly]) {
      const shown = linksToSend(rec.data, rec.inputs, ctx);
      expect(shown.bookingUrl).toBeUndefined();
      const html = renderSite(shown);
      expect(html).not.toContain('href="/book"');
      expect(html).not.toContain('id="book-online"');
      expect(html).not.toContain('Book Appointment');
    }
  });

  test('option link: keeps its own link, no built-in section', async () => {
    const rec = await startDraft(await generate('link', template));
    const shown = linksToSend(rec.data, rec.inputs, NONE);
    expect(shown.bookingUrl).toBe(OWN);
    const html = renderSite(shown);
    expect(html).toContain(`href="${OWN}"`);
    expect(html).not.toContain('id="book-online"');
  });

  test.each(['google', 'scratch'] as Opt[])('option %s: with a live scheduler the Book online section shows (heading and button, no service list)', async (opt) => {
    const rec = await startDraft(await generate(opt, template));
    const live: LinkContext = { ents: { known: true, hosting: true, bookings: true, store: false }, shop: { slug: 's', purchaseLinked: true, bookingsEnabled: true }, storeEnabled: false };
    const html = renderSite(linksToSend(rec.data, rec.inputs, live));
    const strip = /<section id="book-online".*?<\/section>/s.exec(html)?.[0] ?? '';
    expect(strip).toContain('href="/book"');
    expect(strip).not.toContain('<li');
  });
});

describe('honest preview status before any plan (A1)', () => {
  const pre: LinkContext = { ents: { known: true, hosting: false, bookings: false, store: false }, shop: null, storeEnabled: false };
  test('not published: status says the Book button goes live once Bookings is set up', () => {
    const s = bookTargetStatus(pre, null);
    expect(s.status).toBe('not-published');
    expect(schedulerWarning(s)?.text).toMatch(/goes live once Bookings is set up/);
  });
  test('entitlements still unknown: no warning', () => {
    expect(schedulerWarning(bookTargetStatus({ ...pre, ents: { ...pre.ents, known: false } }, null))).toBeNull();
    expect(bookTargetStatus(null, null).status).toBe('unknown');
  });
});
