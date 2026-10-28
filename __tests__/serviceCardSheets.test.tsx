import React from 'react';
jest.mock('@/constants/theme', () => require('./store/themeMock'));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
let mockProps: any = null;
jest.mock('react-native-webview', () => {
  const R = require('react');
  return { WebView: R.forwardRef((props: any, ref: any) => { mockProps = props; R.useImperativeHandle(ref, () => ({ injectJavaScript: jest.fn() })); return null; }) };
});
const mockOpenForm = jest.fn();
let mockEd: any;
jest.mock('@/components/setup/useServicesEditor', () => ({ useServicesEditor: () => mockEd }));
jest.mock('@/components/setup/ServicesEditor', () => ({ ServicesEditorView: () => null }));
import SitePreview from '@/components/SitePreview';
import { ServicesSheet } from '@/components/sections/ServicesSheet';
import { BookingsServicesSheet } from '@/components/setup/BookingsServicesSheet';
import { shop } from './pagesV2Fixture';

const { act, create } = require('react-test-renderer');
const msg = (o: unknown) => ({ nativeEvent: { data: JSON.stringify(o) } });
const texts = (tree: any) => tree.root.findAll((n: any) => n.type === 'Text').map((n: any) => [].concat(n.props.children).join(''));
const inputValues = (tree: any) => tree.root.findAll((n: any) => n.props?.accessibilityLabel && 'value' in (n.props ?? {}) && typeof n.props.onChangeText === 'function').map((n: any) => n.props.value);

describe('SitePreview: a service card tap', () => {
  test('calls onService with the index, only when editable, and ignores an index the page does not have', async () => {
    const d = await shop({ pages: undefined });
    const on = jest.fn();
    act(() => { create(<SitePreview data={d} editable onEditText={jest.fn()} onEditImage={jest.fn()} onService={on} />); });
    act(() => { mockProps.onMessage(msg({ type: 'service', index: 2 })); });
    expect(on).toHaveBeenCalledWith(2);
    act(() => { mockProps.onMessage(msg({ type: 'service', index: 7 })); });
    expect(on).toHaveBeenCalledTimes(1);
    const off = jest.fn();
    act(() => { create(<SitePreview data={d} editable={false} onEditText={jest.fn()} onEditImage={jest.fn()} onService={off} />); });
    act(() => { mockProps.onMessage(msg({ type: 'service', index: 0 })); });
    expect(off).not.toHaveBeenCalled();
  });
});

describe('ServicesSheet (site data): focusIndex', () => {
  const mount = async (extra: any) => {
    const d = await shop({ pages: undefined });
    let tree: any;
    act(() => { tree = create(<ServicesSheet visible data={d} onChange={jest.fn()} onClose={jest.fn()} upload={jest.fn()} {...extra} />); });
    return tree;
  };
  test('opens that service in the edit form, with Delete', async () => {
    const tree = await mount({ focusIndex: 1 });
    const t = texts(tree);
    expect(t).toContain('Delete');
    expect(inputValues(tree)).toContain('Skin fade');
  });
  test('without a focus the list shows', async () => {
    const t = texts(await mount({}));
    expect(t).not.toContain('Delete');
    expect(t).toContain('Skin fade');
  });
  test('a focus past the end falls back to the list', async () => {
    expect(texts(await mount({ focusIndex: 9 }))).not.toContain('Delete');
  });
});

describe('BookingsServicesSheet: focus', () => {
  const shopProp = { id: 's1', slug: 's' } as never;
  const row = (id: string, name: string, sort: number, showOnSite = true) => ({ id, name, sort, showOnSite });
  const services = [row('a', 'Haircut', 0), row('h', 'Private', 1, false), row('b', 'Skin fade', 2)];
  const el = (props: any) => <BookingsServicesSheet visible shop={shopProp} onServices={jest.fn()} onClose={jest.fn()} upload={jest.fn()} {...props} />;
  beforeEach(() => {
    mockOpenForm.mockClear();
    mockEd = { reload: jest.fn(), setView: jest.fn(), addOwn: jest.fn(), view: { kind: 'list' }, loading: false, services, openForm: mockOpenForm };
  });

  test('opens the shop row the tapped site service mirrors (position skips the hidden row)', () => {
    act(() => { create(el({ focus: { index: 1, title: 'Skin fade' } })); });
    expect(mockOpenForm).toHaveBeenCalledTimes(1);
    expect(mockOpenForm).toHaveBeenCalledWith(services[2]);
  });
  test('waits for the list to load, and opens once per open', () => {
    mockEd.loading = true; mockEd.services = [];
    let r: any;
    act(() => { r = create(el({ focus: { index: 0, title: 'Haircut' } })); });
    expect(mockOpenForm).not.toHaveBeenCalled();
    mockEd = { ...mockEd, loading: false, services };
    act(() => { r.update(el({ focus: { index: 0, title: 'Haircut' } })); });
    expect(mockOpenForm).toHaveBeenCalledWith(services[0]);
    act(() => { r.update(el({ focus: { index: 0, title: 'Haircut' } })); });
    expect(mockOpenForm).toHaveBeenCalledTimes(1);
  });
  test('no focus -> nothing opens; an unknown service -> the list stays', () => {
    act(() => { create(el({})); });
    act(() => { create(el({ focus: { index: 9, title: 'Gone' } })); });
    expect(mockOpenForm).not.toHaveBeenCalled();
  });
  test('"+ Add a service" wins over a focus', () => {
    act(() => { create(el({ startAdd: true, focus: { index: 0, title: 'Haircut' } })); });
    expect(mockEd.addOwn).toHaveBeenCalledTimes(1);
    expect(mockOpenForm).not.toHaveBeenCalled();
  });
});
