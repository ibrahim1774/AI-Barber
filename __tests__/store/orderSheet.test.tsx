import React from 'react';
import { Alert, Linking } from 'react-native';
import { allText, hasButton, press, render, type as typeInto } from './render';
import { order } from './fixtures';

jest.mock('@/constants/theme', () => require('./themeMock'));
jest.mock('@/components/EditSheet', () => {
  const R = require('react');
  return { Sheet: ({ visible, children }: any) => (visible ? R.createElement(R.Fragment, null, children) : null) };
});
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn() }));
const mockMark = jest.fn();
const mockRefund = jest.fn();
jest.mock('@/lib/store/api', () => {
  const actual = jest.requireActual('@/lib/store/api');
  return { ...actual, markOrder: (...a: unknown[]) => mockMark(...a), refundOrder: (...a: unknown[]) => mockRefund(...a) };
});

import { OrderSheet } from '@/components/store/orders/OrderSheet';

let open: jest.SpyInstance;
beforeEach(() => {
  mockMark.mockReset().mockResolvedValue({});
  mockRefund.mockReset().mockResolvedValue({ order: {}, refundedCents: 500, pending: false });
  open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

const mount = (o = order(), locked = false) => {
  const onChanged = jest.fn();
  return render(<OrderSheet order={o} locked={locked} onClose={() => {}} onChanged={onChanged} />).then((tree) => ({ tree, onChanged }));
};

describe('OrderSheet', () => {
  it('Mark ready calls markOrder(ready) and refreshes', async () => {
    const { tree, onChanged } = await mount();
    await press(tree, 'Mark ready');
    expect(mockMark).toHaveBeenCalledWith('o1', 'ready', undefined);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('Mark shipped passes the tracking through', async () => {
    const { tree, onChanged } = await mount(order({ fulfilment: 'shipping', shippingAddress: { name: 'Sam', line1: '1 Main St', city: 'Austin', state: 'TX', postal_code: '78701' } }));
    await press(tree, 'Mark shipped'); // opens the tracking panel
    expect(mockMark).not.toHaveBeenCalled();
    await typeInto(tree, 'Tracking number', '1Z999');
    await typeInto(tree, 'Tracking link', 'https://t.example/1Z999');
    await press(tree, 'Mark shipped');
    expect(mockMark).toHaveBeenCalledWith('o1', 'shipped', { trackingNumber: '1Z999', trackingUrl: 'https://t.example/1Z999' });
    expect(onChanged).toHaveBeenCalled();
  });

  it('rejects a non-https tracking link before calling the server', async () => {
    const { tree } = await mount(order({ fulfilment: 'shipping' }));
    await press(tree, 'Mark shipped');
    await typeInto(tree, 'Tracking link', 'http://t.example');
    await press(tree, 'Mark shipped');
    expect(mockMark).not.toHaveBeenCalled();
    expect(allText(tree).join(' ')).toMatch(/https:\/\//);
  });

  it('partial refund "$5" calls refundOrder(id, 500)', async () => {
    const card = order({ paymentMethod: 'card', paymentStatus: 'paid', amountPaidCents: 3300, status: 'paid' });
    const { tree, onChanged } = await mount(card);
    await press(tree, 'Refund');
    await press(tree, 'Partial');
    await typeInto(tree, 'Refund amount', '$5');
    await press(tree, 'Refund');
    expect(mockRefund).toHaveBeenCalledWith('o1', 500);
    expect(onChanged).toHaveBeenCalled();
  });

  it('a full refund sends no amount, and a pending result says it is processing', async () => {
    mockRefund.mockResolvedValueOnce({ order: {}, refundedCents: 0, pending: true });
    const card = order({ paymentMethod: 'card', paymentStatus: 'paid', amountPaidCents: 3300, status: 'paid' });
    const { tree } = await mount(card);
    await press(tree, 'Refund');
    await press(tree, 'Refund');
    expect(mockRefund).toHaveBeenCalledWith('o1', undefined);
    expect(allText(tree).join(' ')).toContain("Refund is processing. We'll keep trying.");
  });

  it('rejects a refund over the refundable amount', async () => {
    const card = order({ paymentMethod: 'card', paymentStatus: 'paid', amountPaidCents: 3300, status: 'paid' });
    const { tree } = await mount(card);
    await press(tree, 'Refund');
    await press(tree, 'Partial');
    await typeInto(tree, 'Refund amount', '$40');
    await press(tree, 'Refund');
    expect(mockRefund).not.toHaveBeenCalled();
  });

  it('locked still shows the order actions', async () => {
    const { tree } = await mount(order(), true);
    for (const t of ['Mark paid', 'Mark ready', 'Mark done', 'Cancel order']) expect(hasButton(tree, t)).toBe(true);
    expect(allText(tree).join(' ')).not.toContain('Renew your plan');
  });

  it('Call, Text and Email use the customer details', async () => {
    const { tree } = await mount();
    await press(tree, 'Call');
    expect(open).toHaveBeenLastCalledWith('tel:5550102030');
    await press(tree, 'Text');
    expect(open).toHaveBeenLastCalledWith('sms:5550102030');
    await press(tree, 'Email');
    expect(open).toHaveBeenLastCalledWith('mailto:sam@example.com');
  });

  it('cancel asks first', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.style === 'destructive')?.onPress?.();
    });
    const { tree } = await mount();
    await press(tree, 'Cancel order');
    expect(alert).toHaveBeenCalled();
    expect(mockMark).toHaveBeenCalledWith('o1', 'cancel', undefined);
  });

  it('shows who says they paid, and the address', async () => {
    const { tree } = await mount(order({ paymentMethod: 'cashapp', paymentStatus: 'awaiting', customerSaysPaidAt: '2026-10-21T16:00:00Z' }));
    expect(allText(tree).join(' ')).toContain('Sam says they paid by Cash App');
  });

  it('an error from the server is shown in plain words', async () => {
    const { OrderApiError } = jest.requireActual('@/lib/store/api');
    mockMark.mockRejectedValueOnce(new OrderApiError(409, 'not-markable', 'x'));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const { tree, onChanged } = await mount();
    await press(tree, 'Mark ready');
    expect(alert).toHaveBeenCalledWith("Couldn't do that", expect.stringContaining('changed'));
    expect(onChanged).toHaveBeenCalled();
  });
});
