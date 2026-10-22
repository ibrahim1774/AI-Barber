import * as gemini from '@/web/services/geminiService';
import { DEFAULT_PULLQUOTE } from '@/web/lib/render/prime';
import type { WebsiteData } from '@/web/types';
import { api, ApiError } from '@/lib/api';
import { IMAGE_PATHS, editableTextPaths, setPath } from '@/lib/editable';
import {
  applyBookingLink,
  applyHomePrompts,
  fieldLabel,
  imageLabel,
  photoSlots,
  setColour,
  switchDesign,
} from '@/lib/editor';

const booksy = require('./fixtures/scrape-booksy.json');
const BOOKSY_URL = 'https://booksy.com/en-us/dl/show-business/998736';

// Honest sites: generateContent never invents services, so the fixture ticks some.
const site = (over: Partial<WebsiteData> = {}) =>
  gemini
    .generateContent({ shopName: 'Fresh Cuts', area: '', phone: '', colorTheme: '#3b82f6', services: [{ title: 'Haircut', price: '$30' }, { title: 'Beard trim' }] })
    .then((d) => ({ ...d, ...over }));


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

  test('switchDesign to prime seeds only the generic pull quote, never a policy (barber-written only)', async () => {
    const prime = switchDesign(await site(), 'prime');
    expect(prime.policy).toBeUndefined();
    expect(prime.pullQuote).toEqual(DEFAULT_PULLQUOTE);
    expect(prime.pullQuote).not.toBe(DEFAULT_PULLQUOTE);
    expect(editableTextPaths(prime)).toEqual(expect.arrayContaining(['pullQuote.text']));
    // The policy fields stay offered (All fields) so a barber can write one; nothing is pre-filled.
    expect(editableTextPaths(prime)).toEqual(expect.arrayContaining(['policy.title', 'policy.body']));
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
    // The ticked services survive the regeneration (generateContent invents none).
    expect(out.services.map((s) => s.title)).toEqual(['Haircut', 'Beard trim']);
  });

  test('falls back to patching area, phone and address when generation throws', async () => {
    const d = await site();
    jest.spyOn(gemini, 'generateContent').mockRejectedValueOnce(new Error('boom'));
    const out = await applyHomePrompts(d, 'Austin, TX', '512-555-0100');
    expect(out).toEqual({ ...d, area: 'Austin, TX', phone: '512-555-0100', contact: { ...d.contact, address: 'Austin, TX' } });
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
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await applyBookingLink(await site(), BOOKSY_URL)).toBeNull();
    expect(warn).toHaveBeenCalledWith('[home funnel] booking-link scrape failed:', expect.any(ApiError));
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
    // The luxe logo isn't tappable, so the shop name must be in "All fields".
    expect(editableTextPaths(d)).toContain('shopName');
    expect(fieldLabel('shopName')).toBe('Shop name');
    expect(fieldLabel('services.2.title')).toBe('Service 3 name');
    expect(fieldLabel('about.description.0')).toBe('About paragraph 1');
    expect(imageLabel('hero.imageUrl')).toBe('Hero photo');
    expect(imageLabel('gallery.2')).toBe('Gallery 3');
    expect(imageLabel('staff.0.photo')).toBe('Staff 1 photo');
  });
});

test('photoSlots offers every image slot except the never-rendered craft photos', async () => {
  const d = await site({ staff: [{ name: 'Mo', photo: '' }] });
  expect(d.craftImages?.length).toBeGreaterThan(0);
  const slots = photoSlots(d);
  expect(slots.some((p) => p.startsWith('craftImages.'))).toBe(false);
  expect(slots).toEqual(IMAGE_PATHS(d).filter((p) => !p.startsWith('craftImages.')));
  expect(slots).toEqual(expect.arrayContaining(['hero.imageUrl', 'about.imageUrl', 'gallery.0', 'staff.0.photo']));
});
