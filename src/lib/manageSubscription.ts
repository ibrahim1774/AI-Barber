import { Alert, Linking } from 'react-native';

const APPLE_SUBSCRIPTIONS_APP_URL = 'itms-apps://apps.apple.com/account/subscriptions';
const APPLE_SUBSCRIPTIONS_WEB_URL = 'https://apps.apple.com/account/subscriptions';

/**
 * Opens Apple's subscription management (change the card, update the payment method, renew, cancel). Neither
 * Superwall nor an installed expo module exposes StoreKit's manage-subscriptions sheet (only Superwall's Customer
 * Center, which is a different screen), so this is the App Store link; the https form is the fallback.
 * Never throws: the last fallback tells the user where to go by hand.
 */
export async function openManageSubscription(): Promise<void> {
  try {
    await Linking.openURL(APPLE_SUBSCRIPTIONS_APP_URL);
    return;
  } catch {
    // fall through to the web form
  }
  try {
    await Linking.openURL(APPLE_SUBSCRIPTIONS_WEB_URL);
  } catch {
    Alert.alert('Manage subscription', 'Open Settings → your name → Subscriptions on this iPhone.');
  }
}
