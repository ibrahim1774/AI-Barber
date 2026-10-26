/**
 * Every option screen and sub-screen of the start flow shows a visible Back control (chevron + "Back", >= 44 pt,
 * outside the scroll view) that returns to the start screen, including mid-import and during generation.
 * Root cause of the missing button on device: the full-screen import overlay and /generating covered or lacked it.
 */
import React from 'react';
import { Alert, StyleSheet } from 'react-native';
import { act, render as baseRender } from './store/render';

const mockReplace = jest.fn();
const mockPush = jest.fn();
const mockBack = jest.fn();
let mockCanGoBack = false;
jest.mock('expo-router', () => ({
  router: {
    replace: (...a: unknown[]) => mockReplace(...a),
    push: (...a: unknown[]) => mockPush(...a),
    back: () => mockBack(),
    canGoBack: () => mockCanGoBack,
    canDismiss: () => false,
  },
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 47, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/constants/theme', () => ({ ...require('./store/themeMock'), swatchLabel: (c: string) => c }));

import BookingLink from '@/app/booking-link';
import FindListing from '@/app/find-listing';
import Manual from '@/app/manual';
import ImportReview from '@/app/import-review';
import Generating from '@/app/generating';
import * as store from '@/lib/siteStore';
import { startDraft } from '@/lib/flow';
import { toShopSite } from '@/lib/importer';

const booksy = require('./fixtures/scrape-booksy.json');
const LINK = 'https://booksy.com/en-us/dl/show-business/998736';

const mounted: any[] = [];
async function render(el: React.ReactElement) {
  const tree = await baseRender(el);
  mounted.push(tree);
  return tree;
}
afterEach(async () => {
  jest.useRealTimers();
  await act(async () => { while (mounted.length) mounted.pop().unmount(); });
});

const backs = (tree: any) =>
  tree.root.findAll((n: any) => n.props?.accessibilityRole === 'button' && n.props.accessibilityLabel === 'Back' && typeof n.props.onPress === 'function');
const input = (tree: any, label: string) => tree.root.findAll((n: any) => n.props?.accessibilityLabel === label && typeof n.props.onChangeText === 'function')[0];
const textOf = (n: any): string => (n.children ?? []).map((c: any) => (typeof c === 'string' ? c : textOf(c))).join('');

// Confirms the "Cancel and go back?" alert.
function confirmAlert() {
  const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  return {
    spy,
    confirm: () => {
      const buttons = spy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
      buttons.find((b) => b.text === 'Cancel and go back')!.onPress!();
    },
  };
}

beforeEach(async () => {
  mockReplace.mockClear(); mockPush.mockClear(); mockBack.mockClear(); mockCanGoBack = false;
  await store.clearSite();
  jest.restoreAllMocks();
});

const SCREENS: [string, () => React.ReactElement, () => Promise<void>][] = [
  ['booking-link', () => <BookingLink />, async () => {}],
  ['find-listing', () => <FindListing />, async () => {}],
  ['manual', () => <Manual />, async () => {}],
  ['import-review', () => <ImportReview />, async () => { await startDraft(toShopSite(booksy, LINK, 'booking')); }],
  ['generating', () => <Generating />, async () => { await startDraft(toShopSite(booksy, LINK, 'booking')); }],
];

describe.each(SCREENS)('%s', (_name, element, seed) => {
  it('shows one Back control: chevron + "Back" text, at least 44 pt, with a hit slop', async () => {
    await seed();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = await render(element());
    const found = backs(tree);
    expect(found).toHaveLength(1);
    const style = StyleSheet.flatten(found[0].props.style);
    expect(style.minHeight).toBeGreaterThanOrEqual(44);
    const slop = found[0].props.hitSlop;
    expect((slop.top + slop.bottom + style.minHeight) >= 44 && slop.left >= 8).toBe(true);
    expect(textOf(found[0])).toBe('Back');
  });

  it('returns to the start screen even with an empty stack', async () => {
    await seed();
    const { confirm, spy } = confirmAlert();
    const tree = await render(element());
    await act(async () => { backs(tree)[0].props.onPress(); await new Promise((r) => setTimeout(r, 10)); });
    // /generating always asks first; the others go straight to Start while idle.
    if (spy.mock.calls.length) await act(async () => { confirm(); await new Promise((r) => setTimeout(r, 20)); });
    expect(mockReplace).toHaveBeenCalledWith('/start');
    expect(mockBack).not.toHaveBeenCalled();
  });
});

it('the Back bar is pinned under the safe area, outside the scroll view', async () => {
  const tree = await render(<Manual />);
  let bar = backs(tree)[0].parent;
  while (bar && StyleSheet.flatten(bar.props.style)?.position !== 'absolute') bar = bar.parent;
  expect(StyleSheet.flatten(bar.props.style)).toMatchObject({ position: 'absolute', top: 47 });
  expect(tree.root.findAll((n: any) => n.type === 'RCTScrollView' || n.type === 'ScrollView').some((s: any) => s.findAll((n: any) => n.props?.accessibilityLabel === 'Back').length > 0)).toBe(false);
});

describe('mid-import', () => {
  it('booking link: Back stays visible over the progress overlay, asks to cancel, and nothing is saved when the import later lands', async () => {
    let release!: () => void;
    (global as any).fetch = jest.fn(() => new Promise((res) => {
      release = () => res({ status: 200, ok: true, text: async () => JSON.stringify(booksy) });
    }));
    const { spy, confirm } = confirmAlert();
    const tree = await render(<BookingLink />);
    await act(async () => input(tree, 'Your booking link').props.onChangeText(LINK));
    const go = tree.root.findAll((n: any) => n.props?.accessibilityRole === 'button' && typeof n.props.onPress === 'function' && textOf(n) === 'Continue')[0];
    await act(async () => { go.props.onPress(); });
    expect(textOf(tree.root)).toContain('Hang tight');
    expect(backs(tree)).toHaveLength(1);

    await act(async () => { backs(tree)[0].props.onPress(); });
    expect(spy).toHaveBeenCalledWith('Cancel and go back?', expect.any(String), expect.any(Array));
    expect(mockReplace).not.toHaveBeenCalled(); // asking is not cancelling
    await act(async () => { confirm(); await new Promise((r) => setTimeout(r, 10)); });
    expect(mockReplace).toHaveBeenCalledWith('/start');
    expect(textOf(tree.root)).not.toContain('Hang tight');

    await act(async () => { release(); await new Promise((r) => setTimeout(r, 400)); });
    expect(await store.loadSite()).toBeNull();
    expect(mockReplace).not.toHaveBeenCalledWith('/import-review');
  });

  it('keep going leaves the import running', async () => {
    (global as any).fetch = jest.fn(() => new Promise(() => {}));
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = await render(<BookingLink />);
    await act(async () => input(tree, 'Your booking link').props.onChangeText(LINK));
    const go = tree.root.findAll((n: any) => n.props?.accessibilityRole === 'button' && typeof n.props.onPress === 'function' && textOf(n) === 'Continue')[0];
    await act(async () => { go.props.onPress(); });
    await act(async () => { backs(tree)[0].props.onPress(); });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(textOf(tree.root)).toContain('Hang tight');
    expect(mockReplace).not.toHaveBeenCalled();
  });
});

describe('during generation', () => {
  it('cancelling /generating drops the unpublished draft and returns to Start without opening the editor', async () => {
    await startDraft(toShopSite(booksy, LINK, 'booking'));
    jest.useFakeTimers();
    try {
      const { confirm } = confirmAlert();
      const tree = await render(<Generating />);
      await act(async () => { backs(tree)[0].props.onPress(); });
      await act(async () => { confirm(); await Promise.resolve(); await Promise.resolve(); });
      jest.useRealTimers();
      await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
      expect(mockReplace).toHaveBeenCalledWith('/start');
      expect(await store.loadSite()).toBeNull();
      expect(mockReplace).not.toHaveBeenCalledWith('/edit');
    } finally {
      jest.useRealTimers();
    }
  });

  it('a published site\'s record survives a cancelled regenerate', async () => {
    const rec = await startDraft(toShopSite(booksy, LINK, 'booking'));
    await store.saveSite({ ...rec, slug: 'fade-lab', deployedUrl: 'https://fade-lab.example', transactionId: 't1' });
    const { confirm } = confirmAlert();
    const tree = await render(<Generating />);
    await act(async () => { backs(tree)[0].props.onPress(); });
    await act(async () => { confirm(); await new Promise((r) => setTimeout(r, 30)); });
    expect(mockReplace).toHaveBeenCalledWith('/start');
    expect((await store.loadSite())?.slug).toBe('fade-lab');
  });
});

it('manual: Back while the site is being built asks first, then leaves and saves nothing', async () => {
  let release!: () => void;
  (global as any).fetch = jest.fn(() => new Promise((res) => { release = () => res({ status: 200, ok: true, text: async () => '{}' }); }));
  const { spy, confirm } = confirmAlert();
  const tree = await render(<Manual />);
  await act(async () => input(tree, 'Barbershop name').props.onChangeText('Fade Lab'));
  await act(async () => input(tree, 'Local service area').props.onChangeText('Austin, TX'));
  await act(async () => input(tree, 'Phone number').props.onChangeText('5125550142'));
  const go = tree.root.findAll((n: any) => n.props?.accessibilityRole === 'button' && typeof n.props.onPress === 'function' && textOf(n) === 'Build my website')[0];
  await act(async () => { go.props.onPress(); });
  await act(async () => { backs(tree)[0].props.onPress(); });
  expect(spy).toHaveBeenCalledTimes(1);
  await act(async () => { confirm(); await new Promise((r) => setTimeout(r, 10)); });
  expect(mockReplace).toHaveBeenCalledWith('/start');
  await act(async () => { release?.(); await new Promise((r) => setTimeout(r, 400)); });
  expect(await store.loadSite()).toBeNull();
  expect(mockReplace).not.toHaveBeenCalledWith('/generating');
});
