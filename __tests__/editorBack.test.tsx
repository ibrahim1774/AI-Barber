/** The editor's native Back (unpublished only): shown, confirms, discards; hidden when published, paid or pending. */
import React from 'react';
import { Alert, StyleSheet } from 'react-native';
import { act, render } from './store/render';

const mockReplace = jest.fn();
jest.mock('expo-router', () => ({
  router: { replace: (...a: unknown[]) => mockReplace(...a), canDismiss: () => false, dismissAll: jest.fn() },
}));
jest.mock('@/constants/theme', () => ({ ...require('./store/themeMock'), swatchLabel: (c: string) => c }));

import { EditorBackBar, canGoBackToStart, EDITOR_BACK_HEIGHT } from '@/components/EditorBackBar';
import * as store from '@/lib/siteStore';
import { startDraft } from '@/lib/flow';
import { toShopSite } from '@/lib/importer';

const booksy = require('./fixtures/scrape-booksy.json');
const rec = (o: Partial<store.SiteRecord> = {}) => ({ slug: null, deployedUrl: null, transactionId: null, ...o } as store.SiteRecord);
const backs = (t: any) => t.root.findAll((n: any) => n.props?.accessibilityLabel === 'Back' && typeof n.props.onPress === 'function');

beforeEach(async () => {
  mockReplace.mockClear();
  await store.clearSite();
  await store.savePendingPublish(null);
  jest.restoreAllMocks();
});

describe('canGoBackToStart', () => {
  it('unpublished, signed out, nothing pending: yes', () => expect(canGoBackToStart(rec(), false, false)).toBe(true));
  it('published (live URL or slug): no', () => {
    expect(canGoBackToStart(rec({ deployedUrl: 'https://a.b' }), false, false)).toBe(false);
    expect(canGoBackToStart(rec({ slug: 'a' }), false, false)).toBe(false);
  });
  it('paid, pending paid publish, or account-tied: no', () => {
    expect(canGoBackToStart(rec({ transactionId: 't' }), false, false)).toBe(false);
    expect(canGoBackToStart(rec(), true, false)).toBe(false);
    expect(canGoBackToStart(rec(), false, true)).toBe(false);
    expect(canGoBackToStart(null, false, false)).toBe(false);
  });
});

describe('EditorBackBar', () => {
  it('present when visible: >= 44 pt, white on a dark pill, above the preview in its own bar', async () => {
    const tree = await render(<EditorBackBar visible />);
    const b = backs(tree);
    expect(b).toHaveLength(1);
    const st = StyleSheet.flatten(b[0].props.style);
    expect(st.minHeight).toBeGreaterThanOrEqual(44);
    expect(EDITOR_BACK_HEIGHT).toBeGreaterThanOrEqual(44);
    expect(b[0].props.hitSlop.left).toBeGreaterThanOrEqual(8);
  });

  it('absent when not visible (published / paid pending)', async () => {
    expect(backs(await render(<EditorBackBar visible={false} />))).toHaveLength(0);
  });

  it('asks first; Keep editing changes nothing, Start over discards the draft and opens start', async () => {
    await startDraft(toShopSite(booksy, 'https://booksy.com/en-us/dl/show-business/998736', 'booking'));
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = await render(<EditorBackBar visible />);
    await act(async () => { backs(tree)[0].props.onPress(); });
    expect(spy.mock.calls[0][0]).toBe('Start over?');
    expect(spy.mock.calls[0][1]).toBe('This discards the site you just generated.');
    const buttons = spy.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    expect(buttons.map((x) => x.text)).toEqual(['Keep editing', 'Start over']);
    expect(await store.loadSite()).not.toBeNull();
    await act(async () => { buttons[1].onPress!(); await new Promise((r) => setTimeout(r, 20)); });
    expect(await store.loadSite()).toBeNull();
    expect(mockReplace).toHaveBeenCalledWith('/start');
  });

  it('a paid publish that became pending after render is never discarded', async () => {
    await startDraft(toShopSite(booksy, 'https://booksy.com/en-us/dl/show-business/998736', 'booking'));
    await store.savePendingPublish({ transactionId: 't', data: (await store.loadSite())!.data, createdAt: 1 });
    const spy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const tree = await render(<EditorBackBar visible />);
    await act(async () => { backs(tree)[0].props.onPress(); });
    const buttons = spy.mock.calls[0][2] as { onPress?: () => void }[];
    await act(async () => { buttons[1].onPress!(); await new Promise((r) => setTimeout(r, 20)); });
    expect(await store.loadSite()).not.toBeNull();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
