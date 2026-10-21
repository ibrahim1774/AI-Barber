import React from 'react';
import { act, allText, hasButton, press, render } from './render';
import { order } from './fixtures';

jest.mock('@/constants/theme', () => require('./themeMock'));
jest.mock('@/components/EditSheet', () => {
  const R = require('react');
  return { Sheet: ({ visible, children }: any) => (visible ? R.createElement(R.Fragment, null, children) : null) };
});
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
const mockList = jest.fn();
const mockGet = jest.fn();
jest.mock('@/lib/store/data', () => ({
  listOrders: (...a: unknown[]) => mockList(...a),
  getOrder: (...a: unknown[]) => mockGet(...a),
}));

import { OrdersPane } from '@/components/store/OrdersPane';

beforeEach(() => {
  mockList.mockReset().mockResolvedValue([order(), order({ id: 'o2', number: 1003, status: 'done', customer: { name: 'Ana', phone: '', email: '' } })]);
  mockGet.mockReset();
});

describe('OrdersPane', () => {
  it('lists orders with number, customer, items, total and payment', async () => {
    const tree = await render(<OrdersPane shopId="s1" shopName="Fade Lab" locked={false} onChanged={() => {}} />);
    const text = allText(tree).join(' | ');
    expect(text).toContain('#1004 · Sam Lee');
    expect(text).toContain('2 × Beard oil, Pomade');
    expect(text).toContain('$33');
    expect(text).toContain('Pay at pickup');
    expect(text).toContain('#1003 · Ana');
    expect(mockList).toHaveBeenCalledWith('s1', { limit: 30 });
  });

  it('says so when there are no orders', async () => {
    mockList.mockResolvedValue([]);
    const tree = await render(<OrdersPane shopId="s1" shopName="x" locked={false} onChanged={() => {}} />);
    expect(allText(tree).join(' ')).toContain('No orders yet');
  });

  it('opens the sheet for focusOrderId', async () => {
    mockGet.mockResolvedValue(order({ id: 'o9', number: 1009 }));
    const tree = await render(<OrdersPane shopId="s1" shopName="x" locked={false} focusOrderId="o9" onChanged={() => {}} />);
    expect(mockGet).toHaveBeenCalledWith('o9');
    expect(hasButton(tree, 'Mark ready')).toBe(true);
  });

  it('reopens the same order when a second push arrives (new nonce)', async () => {
    mockGet.mockResolvedValue(order({ id: 'o9', number: 1009 }));
    const tree = await render(<OrdersPane shopId="s1" shopName="x" locked={false} focusOrderId="o9" focusNonce="1" onChanged={() => {}} />);
    expect(mockGet).toHaveBeenCalledTimes(1);
    await act(async () => {
      tree.update(<OrdersPane shopId="s1" shopName="x" locked={false} focusOrderId="o9" focusNonce="1" onChanged={() => {}} />);
    });
    expect(mockGet).toHaveBeenCalledTimes(1);
    await act(async () => {
      tree.update(<OrdersPane shopId="s1" shopName="x" locked={false} focusOrderId="o9" focusNonce="2" onChanged={() => {}} />);
    });
    expect(mockGet).toHaveBeenCalledTimes(2);
  });

  it('shows an error when Load more fails', async () => {
    const full = Array.from({ length: 30 }, (_, i) => order({ id: `x${i}`, number: 2000 + i }));
    mockList.mockResolvedValueOnce(full).mockRejectedValueOnce(new Error('Network down'));
    const tree = await render(<OrdersPane shopId="s1" shopName="x" locked={false} onChanged={() => {}} />);
    await press(tree, 'Load more');
    expect(allText(tree).join(' ')).toContain('Network down');
  });
});
