import React from 'react';
import { StyleSheet } from 'react-native';
jest.mock('@/constants/theme', () => require('./store/themeMock'));
import { ChangeImagePills, tourPillPath } from '@/components/ChangeImagePills';
import { EDITOR_JS } from '@/lib/editorScript';
import { TOURS } from '@/components/tutorial/tours';

const { act, create } = require('react-test-renderer');

const rects = [
  { path: 'hero.imageUrl', x: 0, y: 40, w: 390, h: 300 },
  { path: 'gallery.2', x: 10, y: 400, w: 180, h: 160 },
  { path: 'gallery.3', x: 200, y: 400, w: 180, h: 160 },
];

const pills = (tree: any) => tree.root.findAll((n: any) => n.props?.accessibilityLabel === 'Change image' && n.props?.accessibilityRole === 'button' && typeof n.props?.onPress === 'function');

describe('Change image pills', () => {
  test('N photo rectangles make N pills, placed over their photo', () => {
    let tree: any;
    act(() => { tree = create(<ChangeImagePills items={rects} hidden={false} onPress={() => {}} />); });
    expect(pills(tree)).toHaveLength(3);
    const slots = tree.root.findAll((n: any) => n.props?.pointerEvents === 'box-none' && n.props?.style && !Array.isArray(n.props.style) === false);
    const flat = slots.map((n: any) => StyleSheet.flatten(n.props.style)).filter((s: any) => s.width === 390);
    expect(flat[0]).toMatchObject({ left: 0, top: 40, width: 390, height: 300, justifyContent: 'flex-end', alignItems: 'flex-start' });
  });

  test('a tap passes the photo\'s slot path to the existing photo flow', () => {
    const onPress = jest.fn();
    let tree: any;
    act(() => { tree = create(<ChangeImagePills items={rects} hidden={false} onPress={onPress} />); });
    act(() => { pills(tree)[1].props.onPress(); });
    expect(onPress).toHaveBeenCalledWith('gallery.2');
  });

  test('nothing while the page scrolls or when no photo is on screen', () => {
    let tree: any;
    act(() => { tree = create(<ChangeImagePills items={rects} hidden onPress={() => {}} />); });
    expect(pills(tree)).toHaveLength(0);
    act(() => { tree = create(<ChangeImagePills items={[]} hidden={false} onPress={() => {}} />); });
    expect(pills(tree)).toHaveLength(0);
  });

  test('small plain text chip, 11pt, translucent dark, hitSlop grows the tap area', () => {
    let tree: any;
    act(() => { tree = create(<ChangeImagePills items={rects.slice(0, 1)} hidden={false} onPress={() => {}} />); });
    const pill = pills(tree)[0];
    const style = StyleSheet.flatten(pill.props.style({ pressed: false }));
    expect(style.backgroundColor).toBe('rgba(0,0,0,0.55)');
    expect(style.height).toBeUndefined();
    const texts = tree.root.findAll((n: any) => n.props?.children === 'Change image' && n.type === 'Text');
    expect(StyleSheet.flatten(texts[0].props.style).fontSize).toBe(11);
    expect(pill.findAll((n: any) => n.props?.viewBox === '0 0 24 24')).toHaveLength(0);
    const h = pill.props.hitSlop;
    expect(h.top + h.bottom + 11 + 4).toBeGreaterThanOrEqual(44);
  });

  test('stable: re-measures with the same or moved rects keep the same pills mounted', () => {
    let tree: any;
    act(() => { tree = create(<ChangeImagePills items={rects} hidden={false} onPress={() => {}} />); });
    const before = pills(tree)[1];
    act(() => { tree.update(<ChangeImagePills items={rects.map((r) => ({ ...r, y: r.y - 20 }))} hidden={false} onPress={() => {}} />); });
    expect(pills(tree)).toHaveLength(3);
    expect(pills(tree)[1]).toBe(before);
  });

  test('page script streams rects while scrolling and the preview never hides pills for scrolling', () => {
    expect(EDITOR_JS).toContain('liveTimer');
    expect(require('fs').readFileSync(require('path').join(__dirname, '../src/components/SitePreview.tsx'), 'utf8')).toContain('hidden={false}');
  });

  test('the tour points at the hero pill, else the first', () => {
    expect(tourPillPath(rects)).toBe('hero.imageUrl');
    expect(tourPillPath(rects.slice(1))).toBe('gallery.2');
    expect(tourPillPath([])).toBeNull();
  });
});

describe('page script and tour', () => {
  test('the page script reports photo rectangles and scrolling', () => {
    expect(EDITOR_JS).toContain("type: 'rects'");
    expect(EDITOR_JS).toContain("type: 'scrolling'");
    expect(EDITOR_JS).toContain('[data-edit-image]');
    expect(() => new Function(EDITOR_JS)).not.toThrow();
    expect(EDITOR_JS).toMatch(/^[\x00-\x7f]*$/);
  });

  test('the Edit tour\'s photo step points at the Change image pill and the tour keeps at most five steps', () => {
    expect(TOURS.edit.steps.map((s) => s.target)).toEqual(['edit.publish', 'edit.sections', 'edit.pages', 'edit.text', 'edit.changeImage']);
    expect(TOURS.edit.steps.length).toBeLessThanOrEqual(5);
  });
});
