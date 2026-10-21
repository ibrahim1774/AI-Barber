const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({ router: { navigate: (...a: unknown[]) => mockNavigate(...a), push: jest.fn() } }));

import { isBookingPush, isOrderPush, openPush, orderPushHref } from '@/lib/bookings/push';

beforeEach(() => mockNavigate.mockReset());

describe('order pushes', () => {
  it('{ kind: order, orderId } opens the Store tab on Orders with the order', () => {
    expect(openPush({ kind: 'order', orderId: 'abc-123' })).toBe(true);
    expect(mockNavigate).toHaveBeenCalledWith('/(tabs)/store?tab=orders&orderId=abc-123');
    expect(orderPushHref('abc-123')).toBe('/(tabs)/store?tab=orders&orderId=abc-123');
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
