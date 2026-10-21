/**
 * Jest stand-in for react-native-purchases (RevenueCat): no native module.
 * Every static is a jest.fn; the enums carry the real string values.
 */
export const PURCHASES_ARE_COMPLETED_BY_TYPE = { MY_APP: 'MY_APP', REVENUECAT: 'REVENUECAT' } as const;
export const STOREKIT_VERSION = { STOREKIT_1: 'STOREKIT_1', STOREKIT_2: 'STOREKIT_2', DEFAULT: 'DEFAULT' } as const;

const Purchases = {
  configure: jest.fn((_config: unknown) => {}),
  collectDeviceIdentifiers: jest.fn(async () => {}),
  setAppsflyerID: jest.fn(async (_id: string | null) => {}),
  syncPurchases: jest.fn(async () => {}),
  logIn: jest.fn(async (_id: string) => {}),
  PURCHASES_ARE_COMPLETED_BY_TYPE,
  STOREKIT_VERSION,
};

export default Purchases;
