import { Alert, Linking, Platform } from 'react-native';
import { supabase } from '@/lib/supabase';

const APPLE_SUBSCRIPTIONS_APP_URL = 'itms-apps://apps.apple.com/account/subscriptions';
const APPLE_SUBSCRIPTIONS_WEB_URL = 'https://apps.apple.com/account/subscriptions';

/**
 * Opens Apple's subscription management (change the card, update the payment method, renew, cancel). Neither
 * Superwall nor an installed expo module exposes StoreKit's manage-subscriptions sheet (only Superwall's Customer
 * Center, which is a different screen), so this is the App Store link; the https form is the fallback.
 * Never throws: the last fallback tells the user where to go by hand.
 */
export async function openManageSubscription(): Promise<void> {
  if (Platform.OS === 'web') return openStripePortal();
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

/** Web: the Stripe billing portal (change card, switch plan, cancel). The server finds the customer from the signed-in account. */
async function openStripePortal(): Promise<void> {
  try {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) throw new Error('signed-out');
    const base = process.env.EXPO_PUBLIC_API_BASE ?? 'https://www.aibarber.org';
    const r = await fetch(`${base}/api/web-app/portal`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || !body.url) throw new Error('portal');
    window.location.assign(body.url);
  } catch {
    Alert.alert('Manage subscription', "We couldn't open your billing page. Check your connection and try again.");
  }
}
