import React from 'react';
import { allText, hasButton, press, render, act } from '../store/render';

jest.mock('expo-router', () => {
  const R = require('react');
  return {
    router: { push: jest.fn() },
    useLocalSearchParams: () => ({}),
    useFocusEffect: (cb: () => void) => R.useEffect(cb, []),
  };
});
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/constants/theme', () => require('../store/themeMock'));
jest.mock('@/components/ShareSheet', () => ({ ShareSheet: () => null }));
jest.mock('@/components/Icons', () => ({ GearIcon: () => null }));
jest.mock('@/components/bookings/icons', () => ({ ShareIcon: () => null, PlusIcon: () => null }));
jest.mock('@/components/bookings/Fab', () => {
  const { Text } = require('react-native');
  return { Fab: () => <Text>FAB</Text> };
});
jest.mock('@/components/bookings/AddBookingSheet', () => ({ AddBookingSheet: () => null }));
jest.mock('@/components/bookings/AppointmentSheet', () => ({ AppointmentSheet: () => null }));
jest.mock('@/components/bookings/BlockTimeSheet', () => ({ BlockTimeSheet: () => null }));
jest.mock('@/components/bookings/AppointmentRow', () => {
  const { Text } = require('react-native');
  return { AppointmentRow: ({ appt }: any) => <Text>{`appt-${appt.id}`}</Text>, TimeOffRow: () => null };
});
jest.mock('@/components/bookings/Chips', () => ({ BarberChips: () => null }));
jest.mock('@/components/bookings/DateStrip', () => ({ DateStrip: () => null }));
jest.mock('@/components/bookings/EmptyDay', () => ({ EmptyDay: () => null }));

let mockData: any;
jest.mock('@/components/bookings/useBookingsData', () => ({ DAYS_AHEAD: 60, DAYS_BACK: 14, useBookingsData: () => mockData }));
jest.mock('@/lib/siteStore', () => ({ loadSite: async () => null }));
jest.mock('@/lib/subscriptionStatus', () => ({ useSubscriptionStatus: () => 'active', isLocked: () => false }));
const mockPaywall = jest.fn(async (_p: string) => 'declined');
let mockSettled = true;
jest.mock('@/lib/paywall', () => ({ usePaywall: () => mockPaywall, useSuperwallSettled: () => mockSettled }));
const mockCall = jest.fn();
jest.mock('@/lib/setup/ownerApi', () => ({ call: (...a: unknown[]) => mockCall(...a) }));

import Bookings from '@/app/(tabs)/bookings';
import { setSharedPlan } from '@/lib/plan';
import { resetEntitlementsForTests, setEntitlementsFromStatus } from '@/lib/entitlements';

const ents = (...ids: string[]) => act(() => setEntitlementsFromStatus({ status: 'ACTIVE', entitlements: ids.map((id) => ({ id })) }));
const SHOP = { id: 's1', name: 'Fade Lab', slug: 'fade-lab', timezone: 'America/New_York', bookingsEnabled: true };
const DAY = new Date().toISOString();
const planOf = (hosting: boolean, bookings: boolean, expiresAt: string | null = null) => ({
  linked: true, tier: null, entitlements: { hosting, bookings, store: false }, active: hosting, expiresAt, takenDownAt: null, revoked: false, purchaseAccount: 'self',
});

beforeEach(() => {
  resetEntitlementsForTests();
  setSharedPlan(null);
  mockSettled = true;
  mockPaywall.mockClear();
  mockCall.mockReset().mockRejectedValue(new Error('offline'));
  mockData = {
    phase: 'ready', shop: SHOP, members: [], services: [], appts: [], timeOff: [], availability: [], refresh: async () => {},
  };
});

const hasText = (tree: any, re: RegExp) => allText(tree).some((t) => re.test(t));

describe('Bookings tab gating', () => {
  it('unknown entitlements show the spinner, never the upgrade card', async () => {
    mockSettled = false;
    const tree = await render(<Bookings />);
    expect(hasText(tree, /Take bookings online/)).toBe(false);
    expect(tree.root.findAll((n: any) => n.type === 'ActivityIndicator').length).toBeGreaterThan(0);
  });

  it('unknown after settle: the plan endpoint decides', async () => {
    mockCall.mockResolvedValue(planOf(true, true));
    const tree = await render(<Bookings />);
    expect(hasText(tree, /Take bookings online/)).toBe(false);
    expect(hasText(tree, /paused/)).toBe(false);
    expect(hasText(tree, /^Bookings$/)).toBe(true);
    expect(mockCall).toHaveBeenCalledWith('GET', '/api/shop/plan');
  });

  it('unknown after settle and the plan call fails: a retry card, not a spinner', async () => {
    const tree = await render(<Bookings />);
    expect(hasText(tree, /Couldn't load your plan/)).toBe(true);
    expect(tree.root.findAll((n: any) => n.type === 'ActivityIndicator')).toHaveLength(0);
    mockCall.mockResolvedValue(planOf(true, true));
    await press(tree, 'Try again');
    expect(hasText(tree, /^Bookings$/)).toBe(true);
  });

  it('hosting only and no shop: the UpgradeCard, whose button opens bookings_upgrade', async () => {
    ents('hosting');
    mockData = { ...mockData, phase: 'no-shop', shop: null };
    const tree = await render(<Bookings />);
    expect(hasText(tree, /Take bookings online/)).toBe(true);
    await press(tree, 'See the Bookings plan');
    expect(mockPaywall).toHaveBeenCalledWith('bookings_upgrade');
  });

  it('hosting only with a shop: appointments listed, no Fab, no gear, banner shown', async () => {
    ents('hosting');
    mockData = { ...mockData, appts: [{ id: "a1", memberId: "m", start: DAY, end: DAY, status: "confirmed" }] };
    mockCall.mockResolvedValue(planOf(true, false));
    const tree = await render(<Bookings />);
    expect(hasText(tree, /Your booking page is paused/)).toBe(true);
    expect(hasText(tree, /appt-a1/)).toBe(true);
    expect(hasText(tree, /^FAB$/)).toBe(false);
    expect(tree.root.findAll((n: any) => n.props?.accessibilityLabel === 'Booking setup')).toHaveLength(0);
    expect(hasButton(tree, 'Upgrade')).toBe(true);
    await press(tree, 'Upgrade');
    expect(mockPaywall).toHaveBeenCalledWith('bookings_upgrade');
  });

  it('with Bookings: normal (Fab, gear, no banner)', async () => {
    ents('hosting', 'bookings');
    setSharedPlan(planOf(true, true) as never); // this account owns the purchase
    const tree = await render(<Bookings />);
    expect(hasText(tree, /^FAB$/)).toBe(true);
    expect(tree.root.findAll((n: any) => n.props?.accessibilityLabel === 'Booking setup').length).toBeGreaterThan(0);
    expect(hasText(tree, /paused/)).toBe(false);
  });

  it("a second account on the same Apple ID (Superwall paid, purchase is another's): read-only, banner names the other account, no Fab or gear", async () => {
    ents('hosting', 'bookings');
    setSharedPlan({ ...(planOf(true, true) as any), purchaseAccount: 'other', purchaseHint: 'a***@gmail.com' });
    const tree = await render(<Bookings />);
    expect(hasText(tree, /This Apple ID's subscription belongs to another Prime Barber account \(a\*\*\*@gmail\.com\)/)).toBe(true);
    expect(hasText(tree, /^FAB$/)).toBe(false);
    expect(tree.root.findAll((n: any) => n.props?.accessibilityLabel === 'Booking setup')).toHaveLength(0);
  });

  it('hosting inactive for 31 days: only the UpgradeCard', async () => {
    setEntitlementsFromStatus({ status: 'INACTIVE' });
    mockCall.mockResolvedValue(planOf(false, false, new Date(Date.now() - 31 * 86_400_000).toISOString()));
    const tree = await render(<Bookings />);
    expect(hasText(tree, /Take bookings online/)).toBe(true);
    expect(hasText(tree, /Fade Lab/)).toBe(false);
  });

  it('hosting inactive for 29 days: still read-only with the shop shown', async () => {
    setEntitlementsFromStatus({ status: 'INACTIVE' });
    mockCall.mockResolvedValue(planOf(false, false, new Date(Date.now() - 29 * 86_400_000).toISOString()));
    const tree = await render(<Bookings />);
    expect(hasText(tree, /Take bookings online/)).toBe(false);
    expect(hasText(tree, /^Bookings$/)).toBe(true);
    expect(hasText(tree, /^FAB$/)).toBe(false);
  });
});
