import React, { createRef } from 'react';
import { View } from 'react-native';

const mockInject = jest.fn();
let mockProps: any = null;
jest.mock('react-native-webview', () => {
  const R = require('react');
  return { WebView: R.forwardRef((props: any, ref: any) => { mockProps = props; R.useImperativeHandle(ref, () => ({ injectJavaScript: mockInject })); return null; }) };
});
jest.mock('@/constants/theme', () => require('./store/themeMock'));

import SitePreview from '@/components/SitePreview';
import { shop } from './pagesV2Fixture';

const { act, create } = require('react-test-renderer');
const msg = (o: unknown) => ({ nativeEvent: { data: JSON.stringify(o) } });

describe('SitePreview with the in-page chip', () => {
  beforeEach(() => { mockInject.mockClear(); });

  test('sample paths and the note are sent into the page on ready and when they change', async () => {
    const d = await shop({});
    let tree: any;
    act(() => { tree = create(<SitePreview data={d} editable onEditText={jest.fn()} onEditImage={jest.fn()} samplePaths={['hero.imageUrl']} />); });
    const sent = () => mockInject.mock.calls.map((c) => c[0]).filter((s: string) => s.includes('__aibSetSamples'));
    expect(sent().length).toBeGreaterThan(0);
    expect(sent()[0]).toContain('["hero.imageUrl"]');
    expect(sent()[0]).toContain('Sample photo');
    mockInject.mockClear();
    act(() => { mockProps.onMessage(msg({ type: 'ready' })); });
    expect(sent()).toHaveLength(1);
    mockInject.mockClear();
    act(() => { tree.update(<SitePreview data={d} editable onEditText={jest.fn()} onEditImage={jest.fn()} samplePaths={[]} />); });
    expect(sent()[0]).toContain('([],');
  });

  test('an image message opens the change-image flow', async () => {
    const d = await shop({});
    const onEditImage = jest.fn();
    act(() => { create(<SitePreview data={d} editable onEditText={jest.fn()} onEditImage={onEditImage} />); });
    act(() => { mockProps.onMessage(msg({ type: 'image', path: 'hero.imageUrl' })); });
    expect(onEditImage).toHaveBeenCalledWith('hero.imageUrl');
  });

  test('the tour target is an invisible native view over the reported chip', async () => {
    const d = await shop({});
    const ref = createRef<View>();
    let tree: any;
    act(() => { tree = create(<SitePreview data={d} editable onEditText={jest.fn()} onEditImage={jest.fn()} pillTourRef={ref} />); });
    expect(tree.root.findAllByType(View).filter((v: any) => v.props.pointerEvents === 'none')).toHaveLength(0);
    act(() => { mockProps.onMessage(msg({ type: 'rects', items: [{ path: 'hero.imageUrl', x: 6, y: 300, w: 100, h: 19 }] })); });
    const t = tree.root.findAllByType(View).filter((v: any) => v.props.pointerEvents === 'none');
    expect(t).toHaveLength(1);
    expect(t[0].props.style).toMatchObject({ left: 6, top: 300, width: 100, height: 19 });
  });

  test('the hidden flag toggles the page class on change and again on ready', async () => {
    const d = await shop({});
    const sent = () => mockInject.mock.calls.map((c) => c[0]).filter((x: string) => x.includes('__aibSetChipsHidden'));
    let tree: any;
    act(() => { tree = create(<SitePreview data={d} editable onEditText={jest.fn()} onEditImage={jest.fn()} chipsHidden />); });
    expect(sent()[0]).toContain('(true)');
    act(() => { tree.update(<SitePreview data={d} editable onEditText={jest.fn()} onEditImage={jest.fn()} chipsHidden={false} />); });
    expect(sent().pop()).toContain('(false)');
    mockInject.mockClear();
    act(() => { mockProps.onMessage(msg({ type: 'ready' })); });
    expect(sent()).toHaveLength(1);
  });
});
