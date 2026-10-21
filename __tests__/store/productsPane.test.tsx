import React from 'react';
const { act, create } = require('react-test-renderer');
import { ActionSheetIOS, Alert } from 'react-native';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/constants/theme', () => ({
  colors: new Proxy({}, { get: () => '#000' }),
  fonts: new Proxy({}, { get: () => 'System' }),
}));
jest.mock('@/lib/store/photos', () => ({
  ...jest.requireActual('@/lib/store/photos'),
  pickProductPhotos: jest.fn(),
}));
const mockData = {
  listProducts: jest.fn(),
  addProduct: jest.fn(),
  updateProduct: jest.fn(),
  removeProduct: jest.fn(),
  reorderProducts: jest.fn(),
};
jest.mock('@/lib/store/data', () => ({
  listProducts: (...a: unknown[]) => mockData.listProducts(...a),
  addProduct: (...a: unknown[]) => mockData.addProduct(...a),
  updateProduct: (...a: unknown[]) => mockData.updateProduct(...a),
  removeProduct: (...a: unknown[]) => mockData.removeProduct(...a),
  reorderProducts: (...a: unknown[]) => mockData.reorderProducts(...a),
}));

import { ProductsPane } from '@/components/store/products/ProductsPane';
import { pickProductPhotos } from '@/lib/store/photos';

const p = (id: string, over: Record<string, unknown> = {}) => ({
  id, shopId: 's1', name: `Item ${id}`, priceCents: 1250, description: '', photos: [], soldOut: false, sort: 0, ...over,
});

const find = (r: any, label: string) =>
  r.root.findAll((n: any) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];
const press = (r: any, label: string) => act(async () => { await find(r, label).props.onPress(); });
const typeInto = (r: any, label: string, text: string) =>
  act(async () => { r.root.findAll((n: any) => n.props.accessibilityLabel === label && n.props.onChangeText)[0].props.onChangeText(text); });
const texts = (r: any) => r.root.findAll((n: any) => n.type === 'Text').map((n: any) => [].concat(n.props.children).join(''));

async function render(locked = false) {
  let r: any;
  await act(async () => {
    r = create(React.createElement(ProductsPane, { shopId: 's1', locked }));
  });
  return r;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockData.listProducts.mockResolvedValue([p('a'), p('b'), p('c')]);
  mockData.addProduct.mockResolvedValue(p('new'));
  mockData.updateProduct.mockResolvedValue(undefined);
  mockData.removeProduct.mockResolvedValue(undefined);
  mockData.reorderProducts.mockResolvedValue(undefined);
});

describe('ProductsPane', () => {
  it('shows an empty state with a big + when there are no products', async () => {
    mockData.listProducts.mockResolvedValue([]);
    const r = await render();
    expect(texts(r)).toContain('Add your first product');
    await press(r, 'Add product');
    expect(texts(r)).toContain('New product');
  });

  it('the + opens the form, and Save adds the product in cents with photos in order', async () => {
    const r = await render();
    await press(r, 'Add product');
    await typeInto(r, 'Name', '  Matte pomade ');
    await typeInto(r, 'Price in dollars', '$12.50');
    (pickProductPhotos as jest.Mock).mockResolvedValue(['u1', 'u2']);
    jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation((_o: any, cb: any) => cb(1)); // Library
    await press(r, 'Add photo');
    expect(pickProductPhotos).toHaveBeenCalledWith('library', 5, 's1', expect.any(Function));
    await act(async () => { r.root.findByProps({ title: 'Save' }).props.onPress(); });
    expect(mockData.addProduct).toHaveBeenCalledWith('s1', {
      name: 'Matte pomade', priceCents: 1250, description: '', photos: ['u1', 'u2'], soldOut: false,
    });
  });

  it('does not save an invalid draft', async () => {
    const r = await render();
    await press(r, 'Add product');
    await act(async () => { r.root.findByProps({ title: 'Save' }).props.onPress(); });
    expect(mockData.addProduct).not.toHaveBeenCalled();
    expect(texts(r)).toContain('Give your product a name.');
  });

  it('the sold-out switch updates only soldOut', async () => {
    const r = await render();
    await press(r, 'Edit Item a');
    await act(async () => { r.root.findByType(require('react-native').Switch).props.onValueChange(true); });
    await act(async () => { r.root.findByProps({ title: 'Save' }).props.onPress(); });
    expect(mockData.updateProduct).toHaveBeenCalledWith('a', { soldOut: true });
  });

  it('Arrange: down on item 0, then Done, reorders [b, a, c]', async () => {
    const r = await render();
    await act(async () => { find(r, 'Edit Item a').props.onLongPress(); });
    await press(r, 'Move Item a down');
    await press(r, 'Done');
    expect(mockData.reorderProducts).toHaveBeenCalledWith(['b', 'a', 'c']);
  });

  it('Arrange with no change writes nothing', async () => {
    const r = await render();
    await act(async () => { find(r, 'Edit Item a').props.onLongPress(); });
    await press(r, 'Done');
    expect(mockData.reorderProducts).not.toHaveBeenCalled();
  });

  it('Delete asks first, then removes', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const r = await render();
    await press(r, 'Edit Item b');
    const del = r.root.findAll((n: any) => n.props.accessibilityRole === 'button' && typeof n.props.onPress === 'function'
      && n.findAll((c: any) => c.type === 'Text' && c.props.children === 'Delete').length > 0)[0];
    await act(async () => { del.props.onPress(); });
    expect(alert).toHaveBeenCalledWith(
      'Remove Item b?',
      'It leaves your shop page right away. Past orders keep their details.',
      expect.any(Array),
    );
    expect(mockData.removeProduct).not.toHaveBeenCalled();
    const buttons = alert.mock.calls[0][2] as { text: string; onPress?: () => void }[];
    await act(async () => { buttons.find((b) => b.text === 'Remove')!.onPress!(); });
    expect(mockData.removeProduct).toHaveBeenCalledWith('b');
  });

  it('shows a Sold out veil and hides the + and edits when locked', async () => {
    mockData.listProducts.mockResolvedValue([p('a', { soldOut: true })]);
    const r = await render(true);
    expect(texts(r)).toContain('Sold out');
    expect(r.root.findAll((n: any) => n.props.accessibilityLabel === 'Add product')).toHaveLength(0);
    await act(async () => { find(r, 'Item a').props.onPress(); });
    expect(texts(r)).not.toContain('Edit product');
  });
});
