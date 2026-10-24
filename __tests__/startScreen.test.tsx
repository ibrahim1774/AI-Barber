/**
 * Start screen (approved 2026-10-24): headline, white subheadline, three option pills, Restore.
 * Each option routes exactly where the old controls did: booking link -> /booking-link,
 * find on Google ("No, I don't have one") -> /find-listing, start from scratch ("classic form") -> /manual.
 */
import React from 'react';
import { act, allText, render } from './store/render';

const mockPush = jest.fn();
const mockRestore = jest.fn();
const mockRefresh = jest.fn(() => Promise.resolve());
jest.mock('expo-router', () => ({ router: { push: (...a: unknown[]) => mockPush(...a), replace: jest.fn(), back: jest.fn() } }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/constants/theme', () => ({ ...require('./store/themeMock'), swatchLabel: (c: string) => c }));
jest.mock('@/lib/reminders', () => ({ refreshReminders: () => mockRefresh() }));
jest.mock('@/lib/restoreFlow', () => ({ useRestoreFlow: () => ({ restore: mockRestore, busy: false }) }));

import Start from '@/app/start';

const byLabel = (tree: any, label: string) =>
  tree.root.findAll((n: any) => n.props?.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];
const press = async (tree: any, label: string) => {
  const node = byLabel(tree, label);
  if (!node) throw new Error(`No button "${label}". Text: ${allText(tree).join(' | ')}`);
  await act(async () => { node.props.onPress(); });
};

describe('start screen', () => {
  beforeEach(() => { mockPush.mockClear(); mockRestore.mockClear(); mockRefresh.mockClear(); });

  it('shows the new headline, subheadline and the three options; no stage chips, no old copy', async () => {
    const tree = await render(<Start />);
    const text = allText(tree).join(' | ');
    expect(text).toContain('Barbers, run it all');
    expect(text).toContain('one place.');
    expect(text).toContain('A custom site, your own booking system & sell your own products.');
    for (const [t, s] of [
      ['Use my booking link', 'Imports services, prices and photos'],
      ['Find me on Google', 'Imports photos, hours and phone'],
      ['Start from scratch', 'Answer a few quick questions'],
    ]) {
      expect(byLabel(tree, t)).toBeTruthy();
      expect(byLabel(tree, t).props.accessibilityHint).toBe(s);
      expect(text).toContain(t);
      expect(text).toContain(s);
    }
    expect(text).not.toMatch(/Import \| Design \| Publish|Do you have a|classic form|don.t have one|Rather type/i);
    expect(text).toContain('Already subscribed? Restore purchases');
  });

  it.each([
    ['Use my booking link', '/booking-link'],
    ['Find me on Google', '/find-listing'],
    ['Start from scratch', '/manual'],
  ])('%s opens %s (and refreshes reminders first)', async (label, href) => {
    const tree = await render(<Start />);
    await press(tree, label);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(href);
  });

  it('Restore purchases still runs the restore flow and navigates nowhere', async () => {
    const tree = await render(<Start />);
    const node = tree.root.findAll((n: any) => n.props?.accessibilityRole === 'button' && typeof n.props.onPress === 'function'
      && allText({ root: n }).join('').startsWith('Already subscribed'))[0];
    await act(async () => { node.props.onPress(); });
    expect(mockRestore).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
  });
});
