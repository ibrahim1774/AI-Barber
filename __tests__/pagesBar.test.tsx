import React from 'react';
jest.mock('@/constants/theme', () => require('./store/themeMock'));
import { PagesBar } from '@/components/PagesBar';
import type { PageChips } from '@/lib/sitePages';

const { act, create } = require('react-test-renderer');

const multi: PageChips = {
  top: [{ key: 'home', title: 'Home' }, { key: 'services', title: 'Services' }, { key: 'reviews', title: 'Reviews' }, { key: 'hours', title: 'Hours' }] as any,
  children: { services: [{ group: 'services', index: 0, title: 'Fade' }, { group: 'services', index: 1, title: 'Beard' }] as any },
};
const single: PageChips = { top: [], children: {} };

function mount(chips: PageChips, extra: Record<string, unknown> = {}) {
  const onSelect = jest.fn();
  const onOpenPages = jest.fn();
  let tree: any;
  act(() => { tree = create(<PagesBar chips={chips} current={{ key: 'home' }} onSelect={onSelect} onOpenPages={onOpenPages} {...extra} />); });
  const btn = (label: string) => tree.root.findAll((n: any) => n.props?.accessibilityLabel === label && typeof n.props?.onPress === 'function')[0];
  return { onSelect, onOpenPages, btn, tree };
}

describe('bottom page tabs', () => {
  test('tapping a tab selects that page', () => {
    const m = mount(multi);
    act(() => { m.btn('Show Reviews').props.onPress(); });
    expect(m.onSelect).toHaveBeenCalledWith({ key: 'reviews' });
  });

  test('the current page is marked selected', () => {
    const m = mount(multi);
    expect(m.btn('Show Home').props.accessibilityState.selected).toBe(true);
    expect(m.btn('Show Hours').props.accessibilityState.selected).toBe(false);
  });

  test('Services shows a chip per service and selects it by index', () => {
    const m = mount(multi, { current: { key: 'services' } });
    act(() => { m.btn('Show Beard').props.onPress(); });
    expect(m.onSelect).toHaveBeenCalledWith({ key: 'services', index: 1 });
  });

  test('the Pages button opens the sheet', () => {
    const m = mount(multi);
    act(() => { m.btn('Pages').props.onPress(); });
    expect(m.onOpenPages).toHaveBeenCalledTimes(1);
  });

  test('disabled: tabs and Pages are disabled', () => {
    const m = mount(multi, { disabled: true });
    expect(m.btn('Show Hours').props.disabled).toBe(true);
    expect(m.btn('Pages').props.disabled).toBe(true);
  });

  test('a single-page site has no page tabs, only the Pages button', () => {
    const m = mount(single);
    expect(m.tree.root.findAll((n: any) => /^Show /.test(n.props?.accessibilityLabel ?? '') && typeof n.props?.onPress === 'function')).toHaveLength(0);
    act(() => { m.btn('Pages').props.onPress(); });
    expect(m.onOpenPages).toHaveBeenCalledTimes(1);
  });
});
