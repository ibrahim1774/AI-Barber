import React from 'react';
import { act, allText, pressRow, render, toggle } from './store/render';

const mockPush = jest.fn();
jest.mock('expo-router', () => {
  const R = require('react');
  return {
    router: { push: (...a: unknown[]) => mockPush(...a), navigate: jest.fn() },
    useFocusEffect: (cb: () => void) => R.useEffect(cb, []),
    useNavigation: () => ({ setOptions: () => {} }),
  };
});
jest.mock('expo-application', () => ({ nativeApplicationVersion: '1.0.0', nativeBuildVersion: '1' }));
jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));
jest.mock('@/constants/theme', () => require('./store/themeMock'));
jest.mock('@/components/Page', () => {
  const R = require('react');
  return { Page: ({ children }: any) => R.createElement(R.Fragment, null, children) };
});
jest.mock('@/components/Icons', () => ({ ChevronRightIcon: () => null, ExternalLinkIcon: () => null }));
jest.mock('@/components/ShareSheet', () => ({ ShareSheet: () => null }));
const mockTakeOffline = jest.fn(async (_tx: unknown) => {});
const mockDeleteLocal = jest.fn(async () => {});
const mockDeleteAccount = jest.fn(async () => {});
jest.mock('@/lib/account', () => ({
  deleteAccountAndData: () => mockDeleteAccount(),
  deleteLocalData: () => mockDeleteLocal(),
  takeWebsiteOffline: (tx: unknown) => mockTakeOffline(tx),
  onSiteAdopted: () => () => {},
}));
const mockSignOut = jest.fn(async () => {});
let mockSession: any = null;
jest.mock('@/lib/auth', () => ({
  signOut: () => mockSignOut(),
  useSession: () => ({ session: mockSession, ready: true }),
}));
const mockResetTo = jest.fn();
jest.mock('@/lib/nav', () => ({ goBackOrHome: jest.fn(), resetTo: (...a: unknown[]) => mockResetTo(...a) }));
jest.mock('@/lib/restoreFlow', () => ({ useRestoreFlow: () => ({ restore: jest.fn(), busy: false }) }));
let mockSite: any = null;
jest.mock('@/lib/siteStore', () => ({ loadSite: async () => mockSite }));
jest.mock('@/lib/subscriptionStatus', () => ({ useSubscriptionStatus: () => 'active', isLocked: () => false, siteOffline: () => false }));
jest.mock('@/lib/useLinkActions', () => ({ useLinkActions: () => ({ open: jest.fn(), copy: jest.fn(), copied: false }) }));
jest.mock('@/lib/paywall', () => ({ usePaywall: () => jest.fn(), useLatestTransactionId: () => async () => 'tx-latest' }));

jest.mock('@/lib/domains/useDomainOffer', () => ({
  useDomainOffer: () => ({ known: true, hasDomain: false, detail: 'Get your own .com — $39/year' }),
}));
let mockRemindersOn = true;
const mockSetReminders = jest.fn(async (on: boolean): Promise<string> => (on ? 'on' : 'off'));
jest.mock('@/lib/reminders', () => ({
  remindersEnabled: async () => mockRemindersOn,
  setRemindersEnabled: (on: boolean) => mockSetReminders(on),
}));
import { Alert, Linking } from 'react-native';
import Settings from '@/app/(tabs)/settings';
import { ApiError } from '@/lib/api';
import { DELETE_ALERT_MESSAGE, LOCAL_DELETE_MESSAGE, OFFLINE_ALERT_MESSAGE } from '@/lib/deleteCopy';

const published = { draftId: 'd', slug: 'fade', deployedUrl: 'https://fade.example', transactionId: 'tx-site', data: { shopName: 'Fade' }, inputs: {} };
let alertSpy: jest.SpyInstance;
const buttons = () => alertSpy.mock.calls[alertSpy.mock.calls.length - 1][2] as { text: string; onPress?: () => void }[];

beforeEach(() => {
  mockSite = null;
  mockSession = null;
  mockTakeOffline.mockClear();
  mockDeleteAccount.mockClear();
  mockDeleteLocal.mockClear();
  mockResetTo.mockClear();
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('delete account copy', () => {
  it('says the account, website and photos are deleted and the site goes offline; subscription continues; has a Manage subscription button', async () => {
    expect(DELETE_ALERT_MESSAGE).toMatch(/account, your website and its photos are deleted/);
    expect(DELETE_ALERT_MESSAGE).toMatch(/site goes offline/);
    expect(DELETE_ALERT_MESSAGE).toMatch(/subscription continues until you cancel it in Manage subscription/);
    expect(DELETE_ALERT_MESSAGE).not.toMatch(/email/i);
    mockSession = { user: { email: 'b@example.com' } };
    const tree = await render(<Settings />);
    await pressRow(tree, 'Delete account');
    expect(alertSpy.mock.calls[0][1]).toBe(DELETE_ALERT_MESSAGE);
    expect(buttons().map((b) => b.text)).toEqual(['Cancel', 'Manage subscription', 'Delete account']);
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
    buttons()[1].onPress!();
    expect(open).toHaveBeenCalledWith('itms-apps://apps.apple.com/account/subscriptions');
    expect(mockDeleteAccount).not.toHaveBeenCalled();
  });

  it('confirming deletes the account and shows an Account deleted note with Manage subscription', async () => {
    mockSession = { user: { email: 'b@example.com' } };
    const tree = await render(<Settings />);
    await pressRow(tree, 'Delete account');
    await act(async () => { await buttons()[2].onPress!(); });
    expect(mockDeleteAccount).toHaveBeenCalledTimes(1);
    expect(mockResetTo).toHaveBeenCalledWith('/start');
    const last = alertSpy.mock.calls[alertSpy.mock.calls.length - 1];
    expect(last[0]).toBe('Account deleted');
    expect(last[1]).toMatch(/website have been deleted/);
    expect(last[1]).not.toMatch(/stays online|email/i);
  });

  it('Delete data on this phone (signed out) says it is phone-only and points at Take my website offline', async () => {
    const tree = await render(<Settings />);
    await pressRow(tree, 'Delete account');
    expect(alertSpy.mock.calls[0][0]).toBe('Delete data on this phone?');
    expect(alertSpy.mock.calls[0][1]).toContain(LOCAL_DELETE_MESSAGE);
    expect(LOCAL_DELETE_MESSAGE).toMatch(/phone only/);
    expect(LOCAL_DELETE_MESSAGE).toMatch(/Take my website offline/);
    expect(buttons().map((b) => b.text)).toEqual(['Cancel', 'Manage subscription', 'Delete data on this phone']);
  });
});

describe('Take my website offline', () => {
  it('is hidden without a published site', async () => {
    const tree = await render(<Settings />);
    expect(allText(tree)).not.toContain('Take my website offline');
    mockSite = { ...published, slug: null, deployedUrl: null };
    const t2 = await render(<Settings />);
    expect(allText(t2)).not.toContain('Take my website offline');
  });

  it('shows for a no-account user with a published site; confirm dialog, then the server call with the site transaction', async () => {
    mockSite = published;
    const tree = await render(<Settings />);
    expect(allText(tree)).toContain('Take my website offline');
    await pressRow(tree, 'Take my website offline');
    expect(alertSpy.mock.calls[0][0]).toBe('Take your website offline?');
    expect(alertSpy.mock.calls[0][1]).toBe(OFFLINE_ALERT_MESSAGE);
    expect(mockTakeOffline).not.toHaveBeenCalled(); // nothing before the confirm
    expect(buttons().map((b) => b.text)).toEqual(['Cancel', 'Manage subscription', 'Take offline']);
    await act(async () => { await buttons()[2].onPress!(); });
    expect(mockTakeOffline).toHaveBeenCalledWith('tx-site');
    expect(mockResetTo).toHaveBeenCalledWith('/start');
    expect(alertSpy.mock.calls[alertSpy.mock.calls.length - 1][0]).toBe('Website offline');
  });

  it('falls back to the Apple ID latest transaction when the site has none', async () => {
    mockSite = { ...published, transactionId: null };
    const tree = await render(<Settings />);
    await pressRow(tree, 'Take my website offline');
    await act(async () => { await buttons()[2].onPress!(); });
    expect(mockTakeOffline).toHaveBeenCalledWith('tx-latest');
  });

  it('a server refusal keeps the user where they are and explains', async () => {
    mockSite = published;
    mockTakeOffline.mockRejectedValueOnce(new ApiError(403, 'sign-in-required', 'x'));
    const tree = await render(<Settings />);
    await pressRow(tree, 'Take my website offline');
    await act(async () => { await buttons()[2].onPress!(); });
    expect(mockResetTo).not.toHaveBeenCalled();
    const last = alertSpy.mock.calls[alertSpy.mock.calls.length - 1];
    expect(last[0]).toBe('Take my website offline');
    expect(last[1]).toMatch(/Sign in to that account/);
  });

  it('Cancel does nothing', async () => {
    mockSite = published;
    const tree = await render(<Settings />);
    await pressRow(tree, 'Take my website offline');
    expect(buttons()[0].text).toBe('Cancel');
    expect(mockTakeOffline).not.toHaveBeenCalled();
  });
});

describe('Publish reminders switch', () => {
  it('is on by default, switching off calls setRemindersEnabled(false)', async () => {
    mockRemindersOn = true;
    mockSetReminders.mockClear();
    const tree = await render(<Settings />);
    expect(allText(tree)).toContain('Publish reminders');
    const sw = tree.root.findAll((n: any) => n.props?.accessibilityLabel === 'Publish reminders' && typeof n.props.onValueChange === 'function')[0];
    expect(sw.props.value).toBe(true);
    await toggle(tree, 'Publish reminders', false);
    expect(mockSetReminders).toHaveBeenCalledWith(false);
    const sw2 = tree.root.findAll((n: any) => n.props?.accessibilityLabel === 'Publish reminders' && typeof n.props.onValueChange === 'function')[0];
    expect(sw2.props.value).toBe(false);
  });

  it('shows off when the user turned it off before', async () => {
    mockRemindersOn = false;
    const tree = await render(<Settings />);
    const sw = tree.root.findAll((n: any) => n.props?.accessibilityLabel === 'Publish reminders' && typeof n.props.onValueChange === 'function')[0];
    expect(sw.props.value).toBe(false);
    mockRemindersOn = true;
  });

  it('switching on without notification permission flips back and offers iOS Settings', async () => {
    mockRemindersOn = false;
    mockSetReminders.mockResolvedValueOnce('denied');
    const tree = await render(<Settings />);
    await toggle(tree, 'Publish reminders', true);
    const sw = tree.root.findAll((n: any) => n.props?.accessibilityLabel === 'Publish reminders' && typeof n.props.onValueChange === 'function')[0];
    expect(sw.props.value).toBe(false);
    expect(alertSpy.mock.calls[0][0]).toBe('Notifications are off');
    mockRemindersOn = true;
  });
});

describe('Privacy and Terms rows', () => {
  it('open the policy pages with ?app=1', async () => {
    const WebBrowser = require('expo-web-browser');
    WebBrowser.openBrowserAsync.mockClear();
    const tree = await render(<Settings />);
    await pressRow(tree, 'Privacy Policy');
    await pressRow(tree, 'Terms of Service');
    expect(WebBrowser.openBrowserAsync.mock.calls.map((c: any[]) => c[0])).toEqual([
      'https://www.aibarber.org/privacy?app=1',
      'https://www.aibarber.org/terms?app=1',
    ]);
  });
});
