import { generateContent } from '@/web/services/geminiService';
import { DEFAULT_POLICY, DEFAULT_PULLQUOTE } from '@/web/lib/render/prime';
import type { WebsiteData } from '@/web/types';
import { api, ApiError } from '@/lib/api';
import { IMAGE_PATHS, editableTextPaths, setPath } from '@/lib/editable';
import { clearSite, saveSite, type SiteRecord } from '@/lib/siteStore';
import { startDraft } from '@/lib/flow';
import {
  applyBookingLink,
  applyHomePrompts,
  clearOverlayFlags,
  fieldLabel,
  imageLabel,
  markSeen,
  nextOverlay,
  setColour,
  switchDesign,
} from '@/lib/editor';

const booksy = require('./fixtures/scrape-booksy.json');
const BOOKSY_URL = 'https://booksy.com/en-us/dl/show-business/998736';

const site = (over: Partial<WebsiteData> = {}) =>
  generateContent({ shopName: 'Fresh Cuts', area: '', phone: '', colorTheme: '#3b82f6' }).then((d) => ({ ...d, ...over }));

const record = (data: WebsiteData, over: Partial<SiteRecord> = {}): SiteRecord => ({
  draftId: `draft-${Math.random().toString(36).slice(2)}`,
  inputs: { shopName: data.shopName, area: '', phone: '' },
  data,
  updatedAt: 1,
  slug: null,
  deployedUrl: null,
  transactionId: null,
  ...over,
});

afterEach(() => jest.restoreAllMocks());

describe('switchDesign', () => {
  test('switchDesign keeps edited text', async () => {
    const edited = setPath(setPath(await site(), 'hero.heading', 'Sharp Since 1999'), 'services.0.title', 'The Fade');
    const prime = switchDesign(edited, 'prime');
    expect(prime.template).toBe('prime');
    const back = switchDesign(prime, 'luxe');
    expect(back.template).toBe('luxe');
    expect(back.hero.heading).toBe('Sharp Since 1999');
    expect(back.services[0].title).toBe('The Fade');
    // Everything else rides along unchanged (web: { ...prev, template: t }).
    const { template: _a, policy: _b, pullQuote: _c, ...rest } = back;
    const { template: _d, ...orig } = edited;
    expect(rest).toEqual(orig);
  });

  test('switchDesign to prime seeds policy and pullQuote like the web', async () => {
    const prime = switchDesign(await site(), 'prime');
    // The web renders siteData.policy || DEFAULT_POLICY; seeding the same
    // defaults keeps the page identical and makes them editable here.
    expect(prime.policy).toEqual(DEFAULT_POLICY);
    expect(prime.pullQuote).toEqual(DEFAULT_PULLQUOTE);
    expect(prime.policy).not.toBe(DEFAULT_POLICY);
    expect(prime.pullQuote).not.toBe(DEFAULT_PULLQUOTE);
    // ...so they show up as editable paths with both policy fields present.
    expect(editableTextPaths(prime)).toEqual(expect.arrayContaining(['policy.title', 'policy.body', 'pullQuote.text']));
  });

  test('switchDesign keeps an edited policy and pull quote, and luxe only changes the template', async () => {
    const own = await site({ policy: { title: 'House rules', body: 'Be on time.' }, pullQuote: { text: 'Fresh.', accent: 'Always.' } });
    const prime = switchDesign(own, 'prime');
    expect(prime.policy).toEqual({ title: 'House rules', body: 'Be on time.' });
    expect(prime.pullQuote).toEqual({ text: 'Fresh.', accent: 'Always.' });
    const luxe = switchDesign(await site(), 'luxe');
    expect(luxe.policy).toBeUndefined();
    expect(luxe.pullQuote).toBeUndefined();
  });

  test('does not mutate its input', async () => {
    const d = await site();
    const before = JSON.stringify(d);
    switchDesign(d, 'prime');
    expect(JSON.stringify(d)).toBe(before);
  });
});

describe('applyHomePrompts', () => {
  test('applyHomePrompts sets area and phone', async () => {
    const d = setColour(await site({ bookingUrl: 'https://booksy.com/x' }), '#22c55e');
    const out = await applyHomePrompts(d, 'Dallas, TX', '(555) 123-4567');
    expect(out.area).toBe('Dallas, TX');
    expect(out.phone).toBe('(555) 123-4567');
    expect(out.contact.address).toBe('Dallas, TX');
    // Re-generated with the real area baked into the copy.
    expect(out.about.description.join(' ')).toContain('barbershop in Dallas, TX');
    // Carried through like the web: name, theme, booking link.
    expect(out.shopName).toBe('Fresh Cuts');
    expect(out.colorTheme).toBe('#22c55e');
    expect(out.bookingUrl).toBe('https://booksy.com/x');
  });
});

describe('applyBookingLink', () => {
  test('applyBookingLink returns null for unsupported host', async () => {
    const spy = jest.spyOn(api, 'importScrape');
    expect(await applyBookingLink(await site(), 'https://example.com/my-shop')).toBeNull();
    expect(await applyBookingLink(await site(), 'not a link')).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  test('rebuilds from the scrape, keeping the typed name and theme', async () => {
    const spy = jest.spyOn(api, 'importScrape').mockResolvedValue(booksy);
    const d = await site();
    const out = await applyBookingLink(d, `Book me here: ${BOOKSY_URL}`);
    expect(spy).toHaveBeenCalledWith(BOOKSY_URL);
    expect(out).not.toBeNull();
    expect(out!.shopName).toBe('Fresh Cuts');
    expect(out!.colorTheme).toBe('#3b82f6');
    expect(out!.bookingUrl).toBe(BOOKSY_URL);
    expect(out!.template).toBe('luxe');
    expect(out!.services.map((s) => s.title)).toEqual(booksy.services.map((s: any) => s.title ?? s.name));
  });

  test('returns null when the scrape fails', async () => {
    jest.spyOn(api, 'importScrape').mockRejectedValue(new ApiError(502, 'http-502', 'Import failed'));
    expect(await applyBookingLink(await site(), BOOKSY_URL)).toBeNull();
  });
});

test('setColour writes colorTheme', async () => {
  const d = await site();
  const out = setColour(d, '#a855f7');
  expect(out.colorTheme).toBe('#a855f7');
  expect(d.colorTheme).toBe('#3b82f6');
});

describe('labels', () => {
  test('every editable text path and image slot has a readable label', async () => {
    const d = switchDesign(
      await site({ staff: [{ name: 'Mo', photo: '' }] }),
      'prime',
    );
    for (const p of editableTextPaths(d)) expect(fieldLabel(p)).not.toMatch(/\.|\d{2,}|undefined/);
    for (const p of IMAGE_PATHS(d)) expect(imageLabel(p)).not.toMatch(/\.|undefined/);
    expect(fieldLabel('shopName')).toBe('Shop name');
    expect(fieldLabel('services.2.title')).toBe('Service 3 name');
    expect(fieldLabel('about.description.0')).toBe('About paragraph 1');
    expect(imageLabel('hero.imageUrl')).toBe('Hero photo');
    expect(imageLabel('gallery.2')).toBe('Gallery 3');
    expect(imageLabel('staff.0.photo')).toBe('Staff 1 photo');
  });
});

describe('nextOverlay (once per draft)', () => {
  test('a name-only site shows prompts, then the guide, then nothing', async () => {
    const r = record(await site());
    expect(await nextOverlay(r)).toBe('prompts');
    await markSeen('prompts', r.draftId);
    expect(await nextOverlay(r)).toBe('guide');
    await markSeen('guide', r.draftId);
    expect(await nextOverlay(r)).toBeNull();
  });

  test('flags are per draft', async () => {
    const d = await site();
    const a = record(d);
    const b = record(d);
    await markSeen('prompts', a.draftId);
    await markSeen('guide', a.draftId);
    expect(await nextOverlay(a)).toBeNull();
    expect(await nextOverlay(b)).toBe('prompts');
  });

  test('an imported site skips the prompts (they would regenerate it) and shows the guide', async () => {
    const r = record(await site(), { inputs: { shopName: 'Fresh Cuts', area: '', phone: '', importedFrom: 'booking' } });
    expect(await nextOverlay(r)).toBe('guide');
    const g = record(await site(), { inputs: { shopName: 'Fresh Cuts', area: '', phone: '', importedFrom: 'gbp' } });
    expect(await nextOverlay(g)).toBe('guide');
  });

  test('a published site shows neither', async () => {
    const r = record(await site(), { slug: 'fresh-cuts', deployedUrl: 'https://fresh-cuts.aibarber.org' });
    expect(await nextOverlay(r)).toBeNull();
  });
});

describe('a new generation resets the flags', () => {
  test('clearOverlayFlags shows both overlays again', async () => {
    const r = record(await site());
    await markSeen('prompts', r.draftId);
    await markSeen('guide', r.draftId);
    await clearOverlayFlags(r.draftId);
    expect(await nextOverlay(r)).toBe('prompts');
  });

  test('startDraft over an existing site (same draftId) shows the prompts again', async () => {
    await clearSite();
    const first = record(await site());
    await saveSite(first);
    await markSeen('prompts', first.draftId);
    await markSeen('guide', first.draftId);
    const again = await startDraft({ inputs: { shopName: 'Second Cut', area: '', phone: '' }, site: await site({ shopName: 'Second Cut' }) });
    expect(again.draftId).toBe(first.draftId);
    expect(await nextOverlay(again)).toBe('prompts');
  });
});
