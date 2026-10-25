import React from 'react';
jest.mock('@/constants/theme', () => require('./store/themeMock'));

const { act, create } = require('react-test-renderer');

describe('tool bar: Pages joins the label row, the tab row is gone', () => {
  const { PublishBar } = require('@/components/PublishBar');
  jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
  const labels = (tree: any) => tree.root.findAll((n: any) => n.type === 'Text' && typeof n.props?.children === 'string').map((n: any) => n.props.children);
  const mount = (over: Record<string, unknown> = {}) => {
    const f = { onPages: jest.fn(), onSections: jest.fn(), onText: jest.fn(), onPhotos: jest.fn(), onPublish: jest.fn() };
    let tree: any;
    act(() => { tree = create(<PublishBar {...f} {...over} />); });
    return { f, tree };
  };

  test('five items in one row: Pages, Sections, Text, Photos, Publish; no Colour', () => {
    const { tree } = mount();
    expect(labels(tree)).toEqual(['Pages', 'Sections', 'Text', 'Photos', 'Publish']);
    const flat = (st: any) => Object.assign({}, ...[st].flat(3).filter(Boolean));
    const row = tree.root.findAll((n: any) => n.type === 'View' && flat(n.props.style).flexDirection === 'row')[0];
    const { gap, paddingHorizontal } = flat(row.props.style);
    // 375pt SE: five flex items share what padding and gaps leave, >= 60pt each (labels shrink to fit).
    expect((375 - 2 * paddingHorizontal - 4 * gap) / 5.2).toBeGreaterThanOrEqual(60);
  });

  test('Pages opens the widget and respects disabled', () => {
    const { f, tree } = mount();
    const pages = () => tree.root.findAll((n: any) => typeof n.props?.onPress === 'function' && n.props?.accessibilityHint === 'Pick, add, hide and reorder pages')[0];
    act(() => { pages().props.onPress(); });
    expect(f.onPages).toHaveBeenCalledTimes(1);
    act(() => { tree.update(<PublishBar {...f} disabled />); });
    expect(pages().props.disabled).toBe(true);
  });

  test('PagesBar (the tab row) no longer exists', () => {
    expect(() => require('@/components/PagesBar')).toThrow();
  });
});

describe('floating colour panel', () => {
  const { ColourButton } = require('@/components/ColourButton');
  const btn = (tree: any, label: string) => tree.root.findAll((n: any) => n.props?.accessibilityLabel === label && typeof n.props?.onPress === 'function')[0];

  test('Colour header opens the two-column swatch grid in place; a pick applies and marks the active swatch', () => {
    const onPick = jest.fn();
    let tree: any;
    act(() => { tree = create(<ColourButton current="#22c55e" onPick={onPick} />); });
    expect(tree.root.findAll((n: any) => /^Use color/.test(n.props?.accessibilityLabel ?? '') && typeof n.props?.onPress === 'function')).toHaveLength(0);
    act(() => { btn(tree, 'Colour').props.onPress(); });
    const sw = tree.root.findAll((n: any) => /^Use color/.test(n.props?.accessibilityLabel ?? '') && typeof n.props?.onPress === 'function');
    expect(sw).toHaveLength(6);
    expect(sw.filter((n: any) => n.props.accessibilityState.selected)).toHaveLength(1);
    act(() => { sw[4].props.onPress(); });
    expect(onPick).toHaveBeenCalledWith('#3b82f6');
  });

  test('disabled blocks opening', () => {
    let tree: any;
    act(() => { tree = create(<ColourButton onPick={jest.fn()} disabled />); });
    expect(btn(tree, 'Colour').props.disabled).toBe(true);
  });
});

describe('floating design switcher', () => {
  const { DesignSwitcher } = require('@/components/DesignSwitcher');
  const radio = (tree: any, label: string) => tree.root.findAll((n: any) => n.props?.accessibilityLabel === label && typeof n.props?.onPress === 'function')[0];

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

  test('web look: DESIGN caption over two stacked compact buttons, active one gold', () => {
    let d: any;
    act(() => { d = create(<DesignSwitcher current="prime" onSelect={() => {}} />); });
    const flat = (st: any) => Object.assign({}, ...[st].flat(3).filter(Boolean));
    const texts = d.root.findAll((n: any) => n.type === 'Text').map((n: any) => n.props.children);
    expect(texts).toEqual(['Design', 'Design 1', 'Design 2']);
    const b2 = flat(radio(d, 'Design 2').props.style);
    expect(b2.minHeight).toBeGreaterThanOrEqual(31);
    expect(b2.backgroundColor).toBeDefined();
    expect(flat(radio(d, 'Design 1').props.style).backgroundColor).toBeUndefined();
  });
});
