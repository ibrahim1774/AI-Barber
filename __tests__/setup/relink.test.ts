const mockShopSetup = jest.fn();
const mockLoadMyShop = jest.fn();
const mockLoadSite = jest.fn();
const mockRegister = jest.fn();
let mockUid: string | null = 'u1';

jest.mock('@/lib/auth', () => ({ currentUserId: () => mockUid }));
jest.mock('@/lib/setup/ownerApi', () => ({
  ...jest.requireActual('@/lib/setup/ownerApi'),
  shopSetup: (b: unknown) => mockShopSetup(b),
}));
jest.mock('@/lib/shop', () => ({ ...jest.requireActual('@/lib/shop'), loadMyShop: () => mockLoadMyShop() }));
jest.mock('@/lib/siteStore', () => ({ loadSite: () => mockLoadSite() }));
jest.mock('@/lib/bookings/push', () => ({ registerPushToken: (id: string) => mockRegister(id) }));

import { registerPushForShop, relinkShopPurchase } from '@/lib/setup/relink';

const site = (tx: string | null) => ({
  draftId: '11111111-1111-4111-8111-111111111111',
  inputs: { shopName: 'Fade Lab' },
  data: { shopName: 'Fade Lab', services: [{ title: 'Cut' }] },
  transactionId: tx,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUid = 'u1';
  mockShopSetup.mockResolvedValue({ shop: { id: 's', slug: 'a' } });
});

describe('relinkShopPurchase', () => {
  it('re-posts setup with the latest transaction and no services when the shop is not linked', async () => {
    mockLoadMyShop.mockResolvedValue({ id: 's', purchaseLinked: false });
    mockLoadSite.mockResolvedValue(site(null));
    expect(await relinkShopPurchase({ latestTransactionId: async () => '777' })).toBe(true);
    expect(mockShopSetup).toHaveBeenCalledWith(expect.objectContaining({ transactionId: '777', services: [], name: 'Fade Lab' }));
  });
  it('uses a transaction the caller already has, without looking one up', async () => {
    mockLoadMyShop.mockResolvedValue({ id: 's', purchaseLinked: false });
    mockLoadSite.mockResolvedValue(site(null));
    const lookup = jest.fn(async () => '1');
    await relinkShopPurchase({ latestTransactionId: lookup, transactionId: '42' });
    expect(lookup).not.toHaveBeenCalled();
    expect(mockShopSetup).toHaveBeenCalledWith(expect.objectContaining({ transactionId: '42' }));
  });
  it('does nothing when already linked or when there is no shop', async () => {
    mockLoadMyShop.mockResolvedValueOnce({ id: 's', purchaseLinked: true });
    expect(await relinkShopPurchase({ latestTransactionId: async () => '1' })).toBe(false);
    mockLoadMyShop.mockResolvedValueOnce(null);
    expect(await relinkShopPurchase({ latestTransactionId: async () => '1' })).toBe(false);
    expect(mockShopSetup).not.toHaveBeenCalled();
  });
  it('never throws', async () => {
    mockLoadMyShop.mockResolvedValue({ id: 's', purchaseLinked: false });
    mockLoadSite.mockResolvedValue(site('9'));
    mockShopSetup.mockRejectedValue(new Error('boom'));
    await expect(relinkShopPurchase({ latestTransactionId: async () => '1' })).resolves.toBe(false);
    mockLoadMyShop.mockRejectedValue(new Error('down'));
    await expect(relinkShopPurchase({ latestTransactionId: async () => '1' })).resolves.toBe(false);
  });
});

describe('registerPushForShop', () => {
  it('registers for the signed-in user, and skips when signed out', async () => {
    await registerPushForShop();
    expect(mockRegister).toHaveBeenCalledWith('u1');
    mockUid = null;
    mockRegister.mockClear();
    await registerPushForShop();
    expect(mockRegister).not.toHaveBeenCalled();
  });
  it('never throws', async () => {
    mockRegister.mockRejectedValue(new Error('x'));
    await expect(registerPushForShop()).resolves.toBeUndefined();
  });
});
