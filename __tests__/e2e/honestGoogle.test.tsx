/**
 * Honest sites, Google path: "Is this you?" from the /api/import-business `match` block, build only
 * after "Yes, that's me", then the services checklist; the ticks go into the scrape payload before
 * buildSiteFromScrape with _platform / _categories kept. "Not my business" builds nothing.
 */
import React from 'react';
import { act, allText, render } from '../store/render';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({ router: { replace: (...a: unknown[]) => mockReplace(...a), push: jest.fn(), back: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/constants/theme', () => ({ ...require('../store/themeMock'), swatchLabel: (c: string) => c }));

import FindListing from '@/app/find-listing';
import { listingMatch, listingSite } from '@/lib/importer';
import { importListing } from '@/lib/flow';
import * as store from '@/lib/siteStore';

const gbp = require('../fixtures/import-business.json');
const MATCH = {
  name: 'Kings Barber Shop & Unisex', address: '123 Bay 53rd St, Brooklyn, NY 11214, USA',
  photoUrl: 'https://lh3.googleusercontent.com/p/1', rating: 4.8, ratingCount: 212, category: 'Barber shop',
};
const withMatch = (m: unknown = MATCH) => ({ ...gbp, _platform: 'gbp', _categories: ['Barber shop'], match: m });

describe('listingMatch', () => {
  it('uses the server match block', () => {
    expect(listingMatch(withMatch())).toEqual(MATCH);
  });

  it('nulls stay null; a non-number or zero rating is no rating (and then no count)', () => {
    expect(listingMatch(withMatch({ ...MATCH, photoUrl: null, rating: '4.5', ratingCount: 9, category: null }))).toEqual({
      ...MATCH, photoUrl: null, rating: null, ratingCount: null, category: null,
    });
    expect(listingMatch(withMatch({ ...MATCH, rating: 0 })).rating).toBeNull();
  });

  it('an older server without match: the same facts from the payload', () => {
    const m = listingMatch({ ...gbp, _categories: ['Barber shop'], aggregateRating: { rating: 4.6, count: 80 } });
    expect(m).toEqual({
      name: gbp.shopName, address: gbp.address, photoUrl: gbp.photos[0], rating: 4.6, ratingCount: 80, category: 'Barber shop',
    });
  });
});

describe('listingSite', () => {
  it('ticked services go in as the payload services; _platform/_categories kept; match not stored', () => {
    const { site, inputs } = listingSite(withMatch(), [{ title: 'Haircut', price: '$25' }, { title: 'Beard trim' }], '#22c55e');
    expect(site.services.map((s) => [s.title, s.price, s.description])).toEqual([['Haircut', '$25', ''], ['Beard trim', '', '']]);
    expect(site.reviewsSource).toBe('Google');
    expect(site.importedFrom).toBe('gbp');
    expect(inputs.importedFrom).toBe('gbp');
    expect(JSON.stringify(site)).not.toContain('"match"');
  });

  it('no ticks: no Services at all', () => {
    expect(listingSite(withMatch(), undefined).site.services).toEqual([]);
  });

  it('importListing (fetch + build) passes ticks through', async () => {
    (global as any).fetch = jest.fn(async () => ({ status: 200, ok: true, text: async () => JSON.stringify(withMatch()) }));
    const r = await importListing({ placeId: 'ChIJ' }, undefined, [{ title: 'Taper' }]);
    expect(r.site.services.map((s) => s.title)).toEqual(['Taper']);
  });
});

describe('the Google path, end to end', () => {
  let calls: string[];
  beforeEach(async () => {
    mockReplace.mockClear();
    await store.clearSite();
    calls = [];
    (global as any).fetch = jest.fn(async (url: string) => {
      const path = new URL(url).pathname;
      calls.push(path);
      const body =
        path === '/api/find-business'
          ? { candidates: [{ title: 'Kings Barber Shop', address: 'Brooklyn', category: 'Barber shop', placeId: 'ChIJk', rating: 4.8, reviews: 212 }], searchedNear: 'Brooklyn' }
          : path === '/api/import-business'
            ? withMatch()
            : { suggestions: [] };
      return { status: 200, ok: true, text: async () => JSON.stringify(body) };
    });
  });

  const buttons = (tree: any, title: string) =>
    tree.root.findAll((n: any) => n.props?.accessibilityRole === 'button' && typeof n.props.onPress === 'function'
      && allText({ root: n }).join('') === title);
  const press = async (tree: any, title: string) => {
    const [b] = buttons(tree, title);
    if (!b) throw new Error(`No "${title}": ${allText(tree).join(' | ')}`);
    await act(async () => {
      await b.props.onPress();
      await new Promise((r) => setTimeout(r, 20));
    });
  };
  const byLabel = (tree: any, label: string) =>
    tree.root.findAll((n: any) => n.props?.accessibilityLabel === label && (n.props.onPress || n.props.onChangeText))[0];

  async function toConfirm() {
    const tree = await render(<FindListing />);
    await act(async () => byLabel(tree, 'Your shop name and city').props.onChangeText('Kings Barber'));
    await press(tree, 'Find my business');
    const row = tree.root.findAll((n: any) => n.props?.accessibilityRole === 'button' && typeof n.props.onPress === 'function'
      && allText({ root: n }).join('').startsWith('Kings Barber Shop'))[0];
    await act(async () => {
      row.props.onPress();
      await new Promise((r) => setTimeout(r, 20));
    });
    return tree;
  }

  it('shows "Is this you?" with the listing; nothing is built until Yes', async () => {
    const tree = await toConfirm();
    const text = allText(tree).join(' | ');
    expect(text).toContain('Is this you?');
    expect(text).toContain('Kings Barber Shop & Unisex');
    expect(text).toContain('Barber shop');
    expect(text).toContain('123 Bay 53rd St');
    expect(text).toContain('★ 4.8 (212)');
    expect(buttons(tree, "Yes, that's me")).toHaveLength(1);
    expect(await store.loadSite()).toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('a failed import keeps the candidate list so the barber can retry or pick another', async () => {
    const real = (global as any).fetch;
    (global as any).fetch = jest.fn(async (url: string) => {
      if (new URL(url).pathname === '/api/import-business') {
        return { status: 500, ok: false, text: async () => JSON.stringify({ error: 'e2e-internal' }) };
      }
      return real(url);
    });
    const tree = await render(<FindListing />);
    await act(async () => byLabel(tree, 'Your shop name and city').props.onChangeText('Kings Barber'));
    await press(tree, 'Find my business');
    const pickRow = () => tree.root.findAll((n: any) => n.props?.accessibilityRole === 'button' && typeof n.props.onPress === 'function'
      && allText({ root: n }).join('').startsWith('Kings Barber Shop'))[0];
    await act(async () => { pickRow().props.onPress(); await new Promise((r) => setTimeout(r, 20)); });
    const text = allText(tree).join(' | ');
    expect(text).not.toContain('e2e-internal');
    expect(text).toContain('Brooklyn');
    expect(pickRow()).toBeDefined();
    (global as any).fetch = real;
    await act(async () => { pickRow().props.onPress(); await new Promise((r) => setTimeout(r, 20)); });
    expect(allText(tree).join(' ')).toContain('Is this you?');
  });

  it('"Not my business" goes back to the search and builds nothing', async () => {
    const tree = await toConfirm();
    await press(tree, 'Not my business');
    expect(allText(tree).join(' ')).not.toContain('Is this you?');
    expect(buttons(tree, 'Find my business')).toHaveLength(1);
    expect(await store.loadSite()).toBeNull();
  });

  it('Yes → the checklist → Build: the draft has exactly the ticked services', async () => {
    const tree = await toConfirm();
    await press(tree, "Yes, that's me");
    expect(allText(tree).join(' ')).toContain('Add your services (optional)');
    await act(async () => byLabel(tree, 'Haircut').props.onPress());
    await act(async () => byLabel(tree, 'Haircut price').props.onChangeText('25'));
    await act(async () => byLabel(tree, 'Line up').props.onPress());
    await press(tree, 'Build my website');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(mockReplace).toHaveBeenCalledWith('/generating');
    const saved = await store.loadSite();
    expect(saved?.data.services.map((s) => [s.title, s.price])).toEqual([['Haircut', '$25'], ['Line up', '']]);
    expect(saved?.data.reviewsSource).toBe('Google');
    expect(calls.filter((c) => c === '/api/import-business')).toHaveLength(1);
  });

  it('Yes and Build with nothing ticked: a site with no Services', async () => {
    const tree = await toConfirm();
    await press(tree, "Yes, that's me");
    await press(tree, 'Build my website');
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect((await store.loadSite())?.data.services).toEqual([]);
  });
});
