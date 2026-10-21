// RevenueCatStart (_layout): RevenueCat configures only once Superwall has
// settled, the same gate as the launch prompts, so no App Store message sheet
// can appear during Superwall's configure.
import { createElement } from 'react';
import Purchases from 'react-native-purchases';
import { resetRevenueCatForTests, syncRevenueCatPurchases } from '@/lib/revenuecat';
import { RevenueCatStart } from '@/lib/revenueCatStart';
// No @types for react-test-renderer here; require keeps it untyped.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { act, create } = require('react-test-renderer');

let mockSettled = false;
jest.mock('@/lib/paywall', () => ({ useSuperwallSettled: () => mockSettled }));

const configure = Purchases.configure as jest.Mock;
const sync = Purchases.syncPurchases as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  resetRevenueCatForTests();
  mockSettled = false;
  process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY = 'appl_test';
});

test('not configured before Superwall has settled; once after, however often it renders', async () => {
  let r: any;
  await act(async () => {
    r = create(createElement(RevenueCatStart));
  });
  expect(configure).not.toHaveBeenCalled();
  await act(async () => r.update(createElement(RevenueCatStart)));
  expect(configure).not.toHaveBeenCalled();

  mockSettled = true;
  await act(async () => r.update(createElement(RevenueCatStart)));
  expect(configure).toHaveBeenCalledTimes(1);
  expect(configure).toHaveBeenCalledWith({
    apiKey: 'appl_test',
    purchasesAreCompletedBy: { type: 'MY_APP', storeKitVersion: 'STOREKIT_2' },
  });

  await act(async () => r.update(createElement(RevenueCatStart)));
  await act(async () => r.unmount());
  await act(async () => {
    create(createElement(RevenueCatStart));
  });
  expect(configure).toHaveBeenCalledTimes(1);
});

test('a sync asked for while Superwall settles happens once configured', async () => {
  let r: any;
  await act(async () => {
    r = create(createElement(RevenueCatStart));
  });
  syncRevenueCatPurchases();
  expect(sync).not.toHaveBeenCalled();

  mockSettled = true;
  await act(async () => r.update(createElement(RevenueCatStart)));
  expect(sync).toHaveBeenCalledTimes(1);
});
