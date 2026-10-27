/**
 * Build 28 report: a signed-out user (site made from scratch, nothing paid) bought Store on the upgrade card and
 * landed back on the same card: no account step, tab still locked. After a paid upgrade with no session the app
 * must take the same path as Publish with an existing subscription: pending publish saved (unclaimed, with the
 * latest transaction id) and route to /claim.
 */
import React from 'react';
import { Alert } from 'react-native';
import { act, render as baseRender } from '../store/render';
import { ApiError } from '@/lib/api';

const mounted: any[] = [];
const render = async (el: React.ReactElement) => { const t = await baseRender(el); mounted.push(t); return t; };
afterEach(() => { mounted.splice(0).forEach((t) => act(() => t.unmount())); });

const mockPaywall = jest.fn();
const mockResetTo = jest.fn();
const mockToken = jest.fn();
const mockSave = jest.fn(async (_p: unknown) => {});
const mockClaimStart = jest.fn(async (_t: string) => ({}));
const mockPublish = jest.fn();
let mockLatestTx: () => Promise<string | null> = async () => 'tx-store-1';
const site = { data: { hero: {}, about: {}, gallery: [], services: [] }, updatedAt: 1, draftId: 'd', serverVersion: 3 };
const deps = () => ({
  hasEntitlement: async () => true,
  showPaywall: jest.fn(),
  latestTransactionId: () => mockLatestTx(),
  iosPublish: mockPublish,
  claimStart: mockClaimStart,
  accessToken: () => mockToken(),
  store: {
    loadSite: async () => site,
    loadPendingPublish: async () => null,
    savePendingPublish: (p: unknown) => mockSave(p),
    saveSite: jest.fn(),
  },
});
jest.mock('@/lib/paywall', () => ({
  usePaywall: () => (...a: unknown[]) => mockPaywall(...a),
  usePublishDeps: () => deps(),
  useLatestTransactionId: () => async () => null,
  useSuperwallSettled: () => true,
}));
jest.mock('@/lib/nav', () => ({ resetTo: (...a: unknown[]) => mockResetTo(...a) }));
jest.mock('@/lib/auth', () => ({ currentUserId: () => null, useSession: () => ({ session: null, ready: true }) }));
jest.mock('@/lib/siteStore', () => ({ loadSite: async () => site }));

import { useUpgrade } from '@/lib/tierAccess';

let up: ReturnType<typeof useUpgrade>;
function Probe({ placement }: { placement: 'bookings_upgrade' | 'store_upgrade' }) {
  up = useUpgrade(placement);
  return null;
}

beforeEach(() => {
  [mockPaywall, mockResetTo, mockToken, mockSave, mockClaimStart, mockPublish].forEach((m) => m.mockClear());
  mockClaimStart.mockImplementation(async () => ({}));
  mockLatestTx = async () => 'tx-store-1';
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

describe.each(['store_upgrade', 'bookings_upgrade'] as const)('%s', (placement) => {
  it('signed out + purchased: saves the unclaimed pending publish with the transaction id and goes to /claim', async () => {
    mockPaywall.mockResolvedValue('purchased');
    mockToken.mockResolvedValue(null);
    await render(<Probe placement={placement} />);
    await act(async () => { await up.run(); });
    expect(mockPaywall).toHaveBeenCalledWith(placement);
    expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ transactionId: 'tx-store-1', state: 'unclaimed' }));
    expect(mockResetTo).toHaveBeenCalledWith('/claim');
    expect(mockPublish).not.toHaveBeenCalled();
  });

  it.each([
    ['offline', 0],
    ['apple-unavailable 503', 503],
    ['server error 500', 500],
  ])('claim-start fails (%s): the purchase is still saved unclaimed with its id and /claim opens', async (_n, status) => {
    mockPaywall.mockResolvedValue('purchased');
    mockToken.mockResolvedValue(null);
    mockClaimStart.mockRejectedValue(new ApiError(status, 'x', 'x'));
    await render(<Probe placement={placement} />);
    await act(async () => { await up.run(); });
    expect(mockSave).toHaveBeenLastCalledWith(expect.objectContaining({ transactionId: 'tx-store-1', state: 'unclaimed' }));
    expect(mockResetTo).toHaveBeenCalledWith('/claim');
  });

  it('transaction id not found yet: the paid record is kept and the barber is told to finish in Settings', async () => {
    mockPaywall.mockResolvedValue('purchased');
    mockToken.mockResolvedValue(null);
    mockLatestTx = async () => null;
    await render(<Probe placement={placement} />);
    await act(async () => { await up.run(); });
    expect(mockSave).toHaveBeenCalledWith(expect.objectContaining({ transactionId: null, state: 'unclaimed' }));
    expect(mockSave).not.toHaveBeenCalledWith(null);
    expect(Alert.alert).toHaveBeenCalledWith(expect.any(String), expect.stringContaining('Your payment went through'));
  });

  it('a signed-in user whose token refresh failed is not treated as signed out', async () => {
    jest.requireMock('@/lib/auth').currentUserId = () => 'u1';
    mockPaywall.mockResolvedValue('purchased');
    mockToken.mockResolvedValue(null);
    await render(<Probe placement={placement} />);
    await act(async () => { await up.run(); });
    jest.requireMock('@/lib/auth').currentUserId = () => null;
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockResetTo).not.toHaveBeenCalled();
  });

  it('signed in: unchanged, nothing saved and no navigation', async () => {
    mockPaywall.mockResolvedValue('purchased');
    mockToken.mockResolvedValue('jwt');
    await render(<Probe placement={placement} />);
    await act(async () => { await up.run(); });
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockResetTo).not.toHaveBeenCalled();
  });

  it('declined: nothing saved, no navigation', async () => {
    mockPaywall.mockResolvedValue('declined');
    mockToken.mockResolvedValue(null);
    await render(<Probe placement={placement} />);
    await act(async () => { await up.run(); });
    expect(mockSave).not.toHaveBeenCalled();
    expect(mockResetTo).not.toHaveBeenCalled();
  });
});
