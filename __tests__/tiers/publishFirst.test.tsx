/**
 * Before the website is published, Bookings / Store / the Settings Plan row sell nothing of their own: each opens the
 * ONE publish path (requestPublish -> Edit -> /publishing -> the `publish` paywall) with a plan hint. Signed-in
 * subscribers (a published site) keep the UpgradeCard and the *_upgrade placements.
 */
import React from 'react';
import { ActionSheetIOS } from 'react-native';
import { allText, press, pressRow, render, act } from '../store/render';

const mockNavigate = jest.fn();
jest.mock('expo-router', () => {
  const R = require('react');
  return {
    router: { push: jest.fn(), navigate: (...a: unknown[]) => mockNavigate(...a) },
    useLocalSearchParams: () => ({}),
    useFocusEffect: (cb: () => void) => R.useEffect(cb, []),
    useNavigation: () => ({ setOptions: () => {} }),
  };
});
jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.0.0', nativeBuildVersion: '1' }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
jest.mock('@/constants/theme', () => require('../store/themeMock'));
jest.mock('@/components/Page', () => {
  const R = require('react');
  return { Page: ({ children }: any) => R.createElement(R.Fragment, null, children) };
});
jest.mock('@/components/Icons', () => ({ GearIcon: () => null, ChevronRightIcon: () => null, ExternalLinkIcon: () => null }));
jest.mock('@/components/bookings/icons', () => ({ ShareIcon: () => null, PlusIcon: () => null }));
jest.mock('@/components/ShareSheet', () => ({ ShareSheet: () => null }));
jest.mock('@/components/store/StoreHeader', () => ({ StoreHeader: () => null }));
jest.mock('@/components/store/products/ProductsPane', () => ({ ProductsPane: () => null }));
jest.mock('@/components/bookings/useBookingsData', () => ({
  DAYS_AHEAD: 60, DAYS_BACK: 14,
  useBookingsData: () => ({ phase: 'no-shop', shop: null, members: [], services: [], appts: [], timeOff: [], availability: [], refresh: async () => {} }),
}));
jest.mock('@/lib/account', () => ({ deleteAccountAndData: jest.fn(), deleteLocalData: jest.fn(), onSiteAdopted: () => () => {} }));
jest.mock('@/lib/auth', () => ({ signOut: jest.fn(), currentUserId: () => null, useSession: () => ({ session: null, ready: true }) }));
jest.mock('@/lib/restoreFlow', () => ({ useRestoreFlow: () => ({ restore: jest.fn(), busy: false }) }));
jest.mock('@/lib/useLinkActions', () => ({ useLinkActions: () => ({ open: jest.fn(), copy: jest.fn(), copied: false }) }));
jest.mock('@/lib/domains/useDomainOffer', () => ({ useDomainOffer: () => ({ known: true, hasDomain: false, detail: '' }) }));
jest.mock('@/lib/shop', () => ({ loadMyShop: async () => null }));
let mockSite: any = null;
jest.mock('@/lib/siteStore', () => ({ loadSite: async () => mockSite }));
jest.mock('@/lib/subscriptionStatus', () => ({ useSubscriptionStatus: () => 'active', isLocked: () => false, siteOffline: () => false }));
jest.mock('@/lib/store/data', () => ({
  ...jest.requireActual('@/lib/store/data'),
  loadStoreSettings: async () => ({ storeEnabled: false }),
  countNewOrders: async () => 0,
  hasAnyOrders: async () => false,
}));
const mockPaywall = jest.fn(async (_p: string) => 'declined');
jest.mock('@/lib/paywall', () => ({
  usePublishDeps: () => ({ accessToken: async () => null }),
  usePaywall: () => mockPaywall,
  useLatestTransactionId: () => async () => null,
  useLatestDomainTransactionId: () => async () => null,
  useSuperwallSettled: () => true,
}));
jest.mock('@/lib/setup/ownerApi', () => ({ call: jest.fn(async () => { throw Object.assign(new Error('x'), { status: 401, code: 'unauthorized' }); }) }));

import Bookings from '@/app/(tabs)/bookings';
import Store from '@/app/(tabs)/store';
import Settings from '@/app/(tabs)/settings';
import { setSharedPlan } from '@/lib/plan';
import { resetEntitlementsForTests, setEntitlementsFromStatus } from '@/lib/entitlements';
import { peekPublishHint, takePublishRequest } from '@/lib/publishRequest';
import { OWN_PLAN } from '../../test/ownPlan';

const ents = (...ids: string[]) => act(() => setEntitlementsFromStatus({ status: ids.length ? 'ACTIVE' : 'INACTIVE', entitlements: ids.map((id) => ({ id })) }));
const hasText = (tree: any, re: RegExp) => allText(tree).some((t) => re.test(t));
const UNPUBLISHED = { data: { shopName: 'Fade' }, inputs: { shopName: 'Fade' }, updatedAt: 1, draftId: 'd', slug: null, deployedUrl: null };
const LIVE = { ...UNPUBLISHED, slug: 'fade', deployedUrl: 'https://fade.aibarber.org' };

beforeEach(() => {
  resetEntitlementsForTests();
  setSharedPlan(null);
  takePublishRequest();
  mockSite = UNPUBLISHED;
  mockPaywall.mockClear();
  mockNavigate.mockClear();
});

describe.each([
  ['Bookings', Bookings, /Publish your website to unlock Bookings/, /Take bookings online/, 'bookings', 'bookings_upgrade'],
  ['Store', Store, /Publish your website to unlock the Store/, /Sell from your website/, 'store', 'store_upgrade'],
] as const)('%s tab', (_n, Tab, publishCard, upgradeCard, hint, placement) => {
  it('signed out, site not published: a Publish card whose button runs the one publish path with the plan hint', async () => {
    ents('');
    const tree = await render(<Tab />);
    expect(hasText(tree, publishCard)).toBe(true);
    expect(hasText(tree, upgradeCard)).toBe(false);
    await press(tree, 'Publish');
    expect(peekPublishHint()).toBe(hint);
    expect(takePublishRequest()).toBe(true);
    expect(mockNavigate).toHaveBeenCalledWith('/edit');
    expect(mockPaywall).not.toHaveBeenCalled(); // no *_upgrade placement from the pre-publish tab
  });

  it('paidBefore (Website bought, site still unpublished): the same Publish card, never a second paywall from the tab', async () => {
    ents('hosting');
    const tree = await render(<Tab />);
    expect(hasText(tree, publishCard)).toBe(true);
    await press(tree, 'Publish');
    expect(mockPaywall).not.toHaveBeenCalled();
    expect(peekPublishHint()).toBe(hint);
  });

  it('a published site on a lower plan keeps the UpgradeCard and its *_upgrade placement', async () => {
    mockSite = LIVE;
    ents('hosting');
    setSharedPlan({ ...OWN_PLAN, entitlements: { hosting: true, bookings: false, store: false } });
    const tree = await render(<Tab />);
    expect(hasText(tree, upgradeCard)).toBe(true);
    expect(hasText(tree, publishCard)).toBe(false);
    await press(tree, hint === 'bookings' ? 'See the Bookings plan' : 'See the Store plan');
    expect(mockPaywall).toHaveBeenCalledWith(placement);
    expect(takePublishRequest()).toBe(false);
  });

  it("another account's purchase on this Apple ID keeps the UpgradeCard (Move), not a publish", async () => {
    ents('hosting', 'bookings', 'store');
    setSharedPlan({ ...OWN_PLAN, purchaseAccount: 'other', purchaseHint: null });
    const tree = await render(<Tab />);
    expect(hasText(tree, publishCard)).toBe(false);
  });
});

describe('Website-plan owner upgrade wording', () => {
  it('a Website-plan owner on a published site sees the upgrade wording, not "you need a plan"', async () => {
    mockSite = LIVE;
    ents('hosting');
    setSharedPlan({ ...OWN_PLAN, entitlements: { hosting: true, bookings: false, store: false } });
    const tree = await render(<Store />);
    expect(hasText(tree, /Your plan does not include the Store.*new price/)).toBe(true);
    expect(hasText(tree, /You need a plan/)).toBe(false);
  });
});

describe('Settings Plan row', () => {
  let sheet: jest.SpyInstance;
  beforeEach(() => { sheet = jest.spyOn(ActionSheetIOS, 'showActionSheetWithOptions').mockImplementation(() => {}); });
  afterEach(() => jest.restoreAllMocks());

  it.each([['Upgrade to Bookings', 'bookings'], ['Upgrade to Store', 'store']] as const)(
    'unpublished: "%s" runs the publish path with the %s hint', async (label, hint) => {
      ents('hosting'); // a plan exists but the site isn't published yet (with no plan there is no Plan row at all)
      const tree = await render(<Settings />);
      await pressRow(tree, 'Plan');
      const [config, pick] = sheet.mock.calls[0];
      act(() => pick(config.options.indexOf(label)));
      expect(mockPaywall).not.toHaveBeenCalled();
      expect(peekPublishHint()).toBe(hint);
      expect(mockNavigate).toHaveBeenCalledWith('/edit');
    },
  );

  it('published: still opens the *_upgrade placement', async () => {
    mockSite = LIVE;
    ents('hosting');
    setSharedPlan({ ...OWN_PLAN, entitlements: { hosting: true, bookings: false, store: false } });
    const tree = await render(<Settings />);
    await pressRow(tree, 'Plan');
    const [config, pick] = sheet.mock.calls[0];
    act(() => pick(config.options.indexOf('Upgrade to Bookings')));
    expect(mockPaywall).toHaveBeenCalledWith('bookings_upgrade');
    expect(takePublishRequest()).toBe(false);
  });
});
