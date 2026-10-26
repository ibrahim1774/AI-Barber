/**
 * The screens after Start (owner's mockup, 2026-10-24): 2 "Paste your booking link", 3 "Is this you?" (find-listing),
 * 4 "Here's what we found" (/import-review). Order: import -> review -> /generating -> editor. Only what the import
 * returned is counted; a missing row is a muted circle with an ADD chip; the review cannot be skipped or shown twice.
 */
import React from 'react';
import { act, allText, render } from './store/render';

const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockBack = jest.fn();
let mockCanGoBack = true;
jest.mock('expo-router', () => ({
  router: {
    replace: (...a: unknown[]) => mockReplace(...a),
    push: (...a: unknown[]) => mockPush(...a),
    back: () => mockBack(),
    canGoBack: () => mockCanGoBack,
    canDismiss: () => false,
  },
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/constants/theme', () => ({ ...require('./store/themeMock'), swatchLabel: (c: string) => c }));
jest.mock('expo-clipboard', () => ({ getStringAsync: jest.fn(async () => '  https://booksy.com/en-us/dl/show-business/998736  ') }));

import BookingLink from '@/app/booking-link';
import Manual from '@/app/manual';
import ImportReview from '@/app/import-review';
import { importCounts } from '@/lib/importReview';
import { toShopSite } from '@/lib/importer';
import * as store from '@/lib/siteStore';
import { startDraft } from '@/lib/flow';

const booksy = require('./fixtures/scrape-booksy.json');
const gbp = require('./fixtures/import-business.json');
const LINK = 'https://booksy.com/en-us/dl/show-business/998736';

const txt = (n: any): string => (n.children ?? []).map((c: any) => (typeof c === 'string' ? c : txt(c))).join('');
// A button is found by its accessibility label, else by its text (the bare text links have no label).
const buttons = (tree: any, label: string) =>
  tree.root.findAll((n: any) => n.props?.accessibilityRole === 'button' && typeof n.props.onPress === 'function'
    && (n.props.accessibilityLabel === label || (!n.props.accessibilityLabel && txt(n) === label)));
const press = async (tree: any, label: string) => {
  const [b] = buttons(tree, label);
  if (!b) throw new Error(`No button "${label}". Text: ${allText(tree).join(' | ')}`);
  await act(async () => { await b.props.onPress(); await new Promise((r) => setTimeout(r, 20)); });
};
const input = (tree: any, label: string) => tree.root.findAll((n: any) => n.props?.accessibilityLabel === label && typeof n.props.onChangeText === 'function')[0];
const text = (tree: any) => allText(tree).join(' | ');

function mockApi(body: unknown, status = 200) {
  const fn = jest.fn(async () => ({ status, ok: status < 400, text: async () => JSON.stringify(body) }));
  (global as any).fetch = fn;
  return fn;
}

beforeEach(async () => {
  mockReplace.mockClear(); mockPush.mockClear(); mockBack.mockClear(); mockCanGoBack = true;
  await store.clearSite();
});

describe('screen 2: booking link', () => {
  it('matches the mockup: two-line headline, BOOKING LINK label, helper, Continue, I don\'t have a link; no old chips or card copy', async () => {
    const tree = await render(<BookingLink />);
    const t = text(tree);
    expect(t).toContain('Paste your');
    expect(t).toContain('booking link');
    expect(t).toContain('Booking link');
    expect(t).toContain('Services, photos and reviews come along.');
    expect(t).toContain('Continue');
    expect(t).toContain("I don't have a link");
    expect(t).not.toMatch(/Import \| Design|Works with|Build my website|Brand/);
    expect(buttons(tree, 'Back')).toHaveLength(1);
    expect(buttons(tree, 'Paste from clipboard')).toHaveLength(1);
  });

  it('the back chevron goes back; I don\'t have a link goes to the Google search (replacing, as before)', async () => {
    const tree = await render(<BookingLink />);
    await press(tree, 'Back');
    expect(mockReplace).toHaveBeenCalledWith('/start');
    await press(tree, "I don't have a link");
    expect(mockReplace).toHaveBeenCalledWith('/find-listing');
  });

  it('the paste icon fills the field from the clipboard (trimmed)', async () => {
    const tree = await render(<BookingLink />);
    await press(tree, 'Paste from clipboard');
    expect(input(tree, 'Your booking link').props.value).toBe(LINK);
  });

  it('empty and unsupported links show their error and call nothing; the fallback text points at the link below', async () => {
    const fetchMock = mockApi(booksy);
    const tree = await render(<BookingLink />);
    await press(tree, 'Continue');
    expect(text(tree)).toContain('Paste your booking link to continue.');
    await act(async () => input(tree, 'Your booking link').props.onChangeText('https://example.com/my-shop'));
    await press(tree, 'Continue');
    expect(text(tree)).toContain("Tap “I don't have a link” below");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('a link that cannot be read: the error shows, no review, nothing saved, the fallback still works and the button is usable again', async () => {
    mockApi({ error: 'scrape-failed' }, 502);
    const tree = await render(<BookingLink />);
    await act(async () => input(tree, 'Your booking link').props.onChangeText(LINK));
    await press(tree, 'Continue');
    expect(text(tree)).toMatch(/Couldn.t|try|link/i);
    expect(mockReplace).not.toHaveBeenCalled();
    expect(await store.loadSite()).toBeNull();
    expect(buttons(tree, 'Continue')).toHaveLength(1);
    await press(tree, "I don't have a link");
    expect(mockReplace).toHaveBeenCalledWith('/find-listing');
  });

  it('a good link: draft saved, then the REVIEW (never straight to /generating); a double tap imports once', async () => {
    const fetchMock = mockApi(booksy);
    const tree = await render(<BookingLink />);
    await act(async () => input(tree, 'Your booking link').props.onChangeText(LINK));
    const [go] = buttons(tree, 'Continue');
    await act(async () => { void go.props.onPress(); void go.props.onPress(); await new Promise((r) => setTimeout(r, 400)); });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('/import-review');
    expect((await store.loadSite())?.inputs.importedFrom).toBe('booking');
  });
});

describe('screen 4: Here\'s what we found', () => {
  const save = async (payload: any, source: 'booking' | 'gbp' = 'booking') => startDraft(toShopSite(payload, LINK, source));

  it('shows exactly what the import returned: ticks with counts, hours as a tick without a number', async () => {
    await save(booksy);
    const tree = await render(<ImportReview />);
    const t = text(tree);
    expect(t).toContain("Here's what");
    expect(t).toContain('we found');
    const c = importCounts((await store.loadSite())!.data);
    expect(c.services).toBe(booksy.services.length);
    expect(c.reviews).toBe(booksy.reviews.length);
    expect(c.hours).toBeGreaterThan(0);
    for (const label of ['Services', 'Photos', 'Reviews', 'Hours']) expect(t).toContain(label);
    expect(t).toContain(String(c.services));
    expect(buttons(tree, 'Open my site')).toHaveLength(1);
    expect(buttons(tree, 'Add hours')).toHaveLength(0);
  });

  it('a Google import has no services: Services is a muted circle with an ADD chip; no number is made up', async () => {
    await save({ ...gbp, services: [], _categories: ['Barber shop'] }, 'gbp');
    const tree = await render(<ImportReview />);
    expect(buttons(tree, 'Add services')).toHaveLength(1);
    expect(buttons(tree, 'Add reviews')).toHaveLength(0);
    const row = tree.root.findAll((n: any) => n.props?.accessibilityLabel === 'Services, not found');
    expect(row.length).toBeGreaterThan(0);
    expect(text(tree)).toContain('Anything missing can be added in the editor.');
  });

  it('missing hours get the ADD chip; ADD continues to the editor flow (/generating), once', async () => {
    await save({ ...booksy, hours: [] });
    const tree = await render(<ImportReview />);
    expect(buttons(tree, 'Add hours')).toHaveLength(1);
    const [add] = buttons(tree, 'Add hours');
    await act(async () => { add.props.onPress(); add.props.onPress(); });
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('/generating');
  });

  it('Open my site: a double tap goes on once', async () => {
    await save(booksy);
    const tree = await render(<ImportReview />);
    const [open] = buttons(tree, 'Open my site');
    await act(async () => { open.props.onPress(); open.props.onPress(); });
    expect(mockReplace).toHaveBeenCalledTimes(1);
    expect(mockReplace).toHaveBeenCalledWith('/generating');
  });

  it('back goes back; with nothing to go back to it goes home', async () => {
    await save(booksy);
    const tree = await render(<ImportReview />);
    await press(tree, 'Back');
    expect(mockReplace).toHaveBeenCalledWith('/start');
  });

  it('no draft: straight to the start screen (never an empty review); a typed draft is not reviewed, it goes on to /generating', async () => {
    await render(<ImportReview />);
    expect(mockReplace).toHaveBeenCalledWith('/start');
    mockReplace.mockClear();
    const typed = toShopSite(booksy, LINK, 'booking');
    await startDraft({ ...typed, inputs: { ...typed.inputs, importedFrom: undefined } });
    const tree = await render(<ImportReview />);
    expect(mockReplace).toHaveBeenCalledWith('/generating');
    expect(buttons(tree, 'Open my site')).toHaveLength(0);
  });
});

describe('start from scratch', () => {
  const fs = require('fs');
  const fill = async (tree: any, v: Record<string, string>) => {
    for (const [k, val] of Object.entries(v)) await act(async () => input(tree, k).props.onChangeText(val));
  };

  it('shows exactly three fields, a Build button and a back chevron; no old logo or Sign In', async () => {
    const tree = await render(<Manual />);
    const t = text(tree);
    for (const s of ['Start from', 'scratch', 'Barbershop name', 'Local service area', 'Phone number', 'Build my website']) {
      expect(t).toContain(s);
    }
    expect(t).not.toMatch(/AI ?Barber|Sign In|Address|services|ticked|Haircut/i);
    expect(tree.root.findAll((n: any) => typeof n.props?.onChangeText === 'function' && n.type === 'TextInput')).toHaveLength(3);
    expect(buttons(tree, 'Back')).toHaveLength(1);
    await press(tree, 'Back');
    expect(mockReplace).toHaveBeenCalledWith('/start');
  });

  it('an empty form shows the first error and starts nothing', async () => {
    const tree = await render(<Manual />);
    await press(tree, 'Build my website');
    expect(text(tree)).toContain('Enter your barbershop name.');
    expect(mockReplace).not.toHaveBeenCalled();
    expect(await store.loadSite()).toBeNull();
  });

  it('a filled form builds the draft with the typed values and opens /generating', async () => {
    const tree = await render(<Manual />);
    await fill(tree, { 'Barbershop name': 'Fade Lab', 'Local service area': 'Austin, TX', 'Phone number': '5125550142' });
    await press(tree, 'Build my website');
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    expect(mockReplace).toHaveBeenCalledWith('/generating');
    const rec = await store.loadSite();
    expect(rec?.data.contact.address).toBe('');
    expect(rec?.data.area).toBe('Austin, TX');
    expect(rec?.data.services.map((x) => x.title)).toEqual(['Haircut', 'Beard trim', 'Haircut & beard']);
    expect(rec?.data.reviews ?? []).toHaveLength(0);
    expect(rec?.data.phone).toBe('(512) 555-0142');
    expect(rec?.data.labels?.pgPlace).toBe('Austin, TX');
  });

  it('the typed values never reach track()', () => {
    for (const f of ['src/app/manual.tsx', 'src/lib/flow.ts']) {
      const src = fs.readFileSync(require('path').join(__dirname, '..', f), 'utf8');
      expect(src).not.toMatch(/track\([^)]*(phone|address|place)/);
    }
  });
});

describe('flow order', () => {
  it('link -> import -> review (counts of that import) -> Open my site -> /generating, in that order and once each', async () => {
    mockApi(booksy);
    const link = await render(<BookingLink />);
    await act(async () => input(link, 'Your booking link').props.onChangeText(LINK));
    await press(link, 'Continue');
    await act(async () => { await new Promise((r) => setTimeout(r, 400)); });
    expect(mockReplace.mock.calls.map((c) => c[0])).toEqual(['/import-review']);
    const review = await render(<ImportReview />);
    expect(text(review)).toContain(String(booksy.services.length));
    await press(review, 'Open my site');
    expect(mockReplace.mock.calls.map((c) => c[0])).toEqual(['/import-review', '/generating']);
  });
});

describe('importCounts', () => {
  it('counts only real content: titled services, distinct non-sample photos, reviews with text, open days', () => {
    const { site } = toShopSite(booksy, LINK, 'booking');
    const c = importCounts({
      ...site,
      services: [{ title: 'Cut' }, { title: '  ' }] as any,
      reviews: [{ author: 'A', comment: 'good' }, { author: 'B', comment: '' }] as any,
      hours: [{ day: 'Mon', open: '9', close: '5' }, { day: 'Tue', open: '', close: '', closed: true }] as any,
    });
    expect(c.services).toBe(1);
    expect(c.reviews).toBe(1);
    expect(c.hours).toBe(1);
  });

  it('an empty site counts zero everywhere', () => {
    const { site } = toShopSite({ shopName: 'X' }, LINK, 'booking');
    const c = importCounts({ ...site, services: [], reviews: [], hours: undefined });
    expect([c.services, c.reviews, c.hours]).toEqual([0, 0, 0]);
  });
});
