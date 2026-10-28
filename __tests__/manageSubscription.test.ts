import { Alert, Linking } from 'react-native';
import { openManageSubscription } from '@/lib/manageSubscription';

describe('openManageSubscription', () => {
  afterEach(() => jest.restoreAllMocks());
  it('opens the App Store subscriptions page', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true as never);
    await openManageSubscription();
    expect(open).toHaveBeenCalledTimes(1);
    expect(open).toHaveBeenCalledWith('itms-apps://apps.apple.com/account/subscriptions');
  });
  it('falls back to the https page, then to telling the user where to go', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const open = jest.spyOn(Linking, 'openURL').mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(true as never);
    await openManageSubscription();
    expect(open).toHaveBeenLastCalledWith('https://apps.apple.com/account/subscriptions');
    expect(alert).not.toHaveBeenCalled();
    open.mockReset().mockRejectedValue(new Error('x'));
    await openManageSubscription();
    expect(alert).toHaveBeenCalledWith('Manage subscription', expect.stringContaining('Subscriptions'));
  });
});
