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

describe('Colour moved off the tool bar', () => {
  const { PublishBar } = require('@/components/PublishBar');
  const { ColourButton } = require('@/components/ColourButton');
  jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
  const labels = (tree: any) => tree.root.findAll((n: any) => typeof n.props?.children === 'string').map((n: any) => n.props.children);

  test('PublishBar no longer has a Colour button', () => {
    let tree: any;
    const f = jest.fn();
    act(() => { tree = create(<PublishBar onSections={f} onText={f} onPhotos={f} onPublish={f} />); });
    expect(labels(tree)).not.toContain('Colour');
    expect(labels(tree)).toContain('Publish');
  });

  test('the floating Colour button opens the sheet and respects disabled', () => {
    const onPress = jest.fn();
    let tree: any;
    act(() => { tree = create(<ColourButton onPress={onPress} />); });
    const b = () => tree.root.findAll((n: any) => n.props?.accessibilityLabel === 'Colour' && typeof n.props?.onPress === 'function')[0];
    act(() => { b().props.onPress(); });
    expect(onPress).toHaveBeenCalledTimes(1);
    act(() => { tree.update(<ColourButton onPress={onPress} disabled />); });
    expect(b().props.disabled).toBe(true);
  });
});

describe('floating design switcher', () => {
  const { DesignSwitcher } = require('@/components/DesignSwitcher');
  const radio = (tree: any, label: string) => tree.root.findAll((n: any) => n.props?.accessibilityLabel === label && typeof n.props?.onPress === 'function')[0];

  test('the bottom bar has no design switcher, only tabs and Pages', () => {
    const m = mount(multi);
    expect(JSON.stringify(m.tree.toJSON())).not.toContain('Switch site design');
  });

  test('marks the active design and switches on tap', () => {
    const onSelect = jest.fn();
    let tree: any;
    act(() => { tree = create(<DesignSwitcher current={undefined} onSelect={onSelect} />); });
    expect(radio(tree, 'Design 1').props.accessibilityState.selected).toBe(true);
    act(() => { radio(tree, 'Design 1').props.onPress(); });
    expect(onSelect).not.toHaveBeenCalled();
    act(() => { radio(tree, 'Design 2').props.onPress(); });
    expect(onSelect).toHaveBeenCalledWith('prime');
  });

  test('busy and disabled block taps', () => {
    const onSelect = jest.fn();
    let tree: any;
    act(() => { tree = create(<DesignSwitcher current="luxe" onSelect={onSelect} busy />); });
    expect(radio(tree, 'Design 2').props.accessibilityState).toMatchObject({ disabled: true, busy: true });
    act(() => { tree.update(<DesignSwitcher current="luxe" onSelect={onSelect} disabled />); });
    expect(radio(tree, 'Design 2').props.accessibilityState.disabled).toBe(true);
  });

  test('Design and Colour are stacked on the left edge: Design above, 44pt each, not overlapping', () => {
    const { ColourButton } = require('@/components/ColourButton');
    let d: any, c: any;
    act(() => { d = create(<DesignSwitcher current="luxe" onSelect={() => {}} />); c = create(<ColourButton onPress={() => {}} />); });
    const flat = (st: any) => Object.assign({}, ...[st].flat(3).filter(Boolean));
    const pill = flat(d.root.findAll((n: any) => n.props?.accessibilityLabel === 'Switch site design')[0].props.style);
    const cb = c.root.findAll((n: any) => n.props?.accessibilityLabel === 'Colour' && typeof n.props?.onPress === 'function')[0].props.style;
    const col = flat(typeof cb === 'function' ? cb({ pressed: false }) : cb);
    expect(pill.position).toBe('absolute'); expect(col.position).toBe('absolute');
    expect(pill.left).toBe(col.left);
    expect(pill.height).toBeGreaterThanOrEqual(44); expect(col.minHeight).toBeGreaterThanOrEqual(44);
    const dy = (x: any) => x.transform[0].translateY;
    expect(dy(pill) + pill.height).toBeLessThanOrEqual(dy(col));
  });
});
