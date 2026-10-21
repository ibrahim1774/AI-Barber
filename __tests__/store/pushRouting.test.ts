const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({ router: { navigate: (...a: unknown[]) => mockNavigate(...a), push: jest.fn() } }));

import { isBookingPush, isOrderPush, openPush, orderPushHref } from '@/lib/bookings/push';

beforeEach(() => mockNavigate.mockReset());

describe('order pushes', () => {
  it('{ kind: order, orderId } opens the Store tab on Orders with the order', () => {
    jest.spyOn(Date, 'now').mockReturnValue(111);
    expect(openPush({ kind: 'order', orderId: 'abc-123' })).toBe(true);
    expect(mockNavigate).toHaveBeenCalledWith('/(tabs)/store?tab=orders&orderId=abc-123&n=111');
    expect(orderPushHref('abc-123', 5)).toBe('/(tabs)/store?tab=orders&orderId=abc-123&n=5');
    jest.restoreAllMocks();
  });
  it('a second push for the same order gets a different nonce', () => {
    const now = jest.spyOn(Date, 'now');
    now.mockReturnValueOnce(1).mockReturnValueOnce(2);
    openPush({ kind: 'order', orderId: 'a' });
    openPush({ kind: 'order', orderId: 'a' });
    expect(mockNavigate.mock.calls[0][0]).not.toBe(mockNavigate.mock.calls[1][0]);
    jest.restoreAllMocks();
  });
  it('an order push without an id is ignored', () => {
    expect(isOrderPush({ kind: 'order' })).toBe(false);
    expect(openPush({ kind: 'order' })).toBe(false);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
  it('an order push is not a booking push', () => {
    expect(isBookingPush({ kind: 'order', orderId: 'x' })).toBe(false);
  });
});

describe('booking pushes are unchanged', () => {
  it('kind booking with a date opens Bookings on that date', () => {
    expect(openPush({ kind: 'booking', date: '2026-10-25' })).toBe(true);
    expect(mockNavigate).toHaveBeenCalledWith({ pathname: '/bookings', params: { date: '2026-10-25' } });
  });
  it('a missing kind with a start opens Bookings on that start', () => {
    expect(openPush({ start: '2026-10-25T14:00:00Z' })).toBe(true);
    expect(mockNavigate).toHaveBeenCalledWith({ pathname: '/bookings', params: { start: '2026-10-25T14:00:00Z' } });
  });
  it('publish reminders and unknown data route nowhere', () => {
    expect(openPush({ reminder: true, kind: 'booking' })).toBe(false);
    expect(openPush(undefined)).toBe(false);
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
