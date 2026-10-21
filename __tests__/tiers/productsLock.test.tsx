import React from 'react';
import { allText, hasButton, press, render } from '../store/render';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/constants/theme', () => require('../store/themeMock'));
jest.mock('@/lib/store/data', () => ({
  listProducts: async () => [], addProduct: jest.fn(), updateProduct: jest.fn(), removeProduct: jest.fn(), reorderProducts: jest.fn(),
}));

import { ProductsPane } from '@/components/store/products/ProductsPane';

it("a plan lock invites the upgrade (and never says the subscription ended)", async () => {
  const up = jest.fn();
  const tree = await render(<ProductsPane shopId="s1" locked lockReason="plan" onUpgrade={up} />);
  const t = allText(tree).join(' | ');
  expect(t).toContain('Open your store with the Store plan');
  expect(t).toContain('Upgrade to Store to add products and reopen your shop page.');
  expect(t).not.toMatch(/subscription has ended/);
  await press(tree, 'Upgrade to Store');
  expect(up).toHaveBeenCalled();
});

it('a lapse keeps the lapsed copy and no upgrade button', async () => {
  const tree = await render(<ProductsPane shopId="s1" locked lockReason="lapsed" onUpgrade={jest.fn()} />);
  expect(allText(tree).join(' | ')).toMatch(/Your subscription has ended/);
  expect(hasButton(tree, 'Upgrade to Store')).toBe(false);
});
