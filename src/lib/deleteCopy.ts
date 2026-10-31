import { Platform } from 'react-native';

/** Copy for deleting an account / taking a site offline (App Store 5.1.1(v)). The server removes the site and its photos. */
export const SUBSCRIPTION_CONTINUES = 'Your subscription continues until you cancel it in Manage subscription.';
/** Apple's own subscription page: the app and the server cannot cancel an Apple subscription, so the user must. */
export const CANCEL_APPLE_SUBSCRIPTION_URL = 'https://apps.apple.com/account/subscriptions';
export const CANCEL_APPLE_SUBSCRIPTION = 'Cancel Apple subscription';
export const DELETE_ALERT_TITLE = 'Delete account?';
const WEB = Platform.OS === 'web';
export const DELETE_ALERT_MESSAGE = WEB
  ? 'Deleting removes your account, your website (it goes offline), its photos, your booking page, services, team and bookings, and cancels your plan so you are not charged again. This can\'t be undone.'
  : 'Deleting your account does not cancel your Apple subscription. Apple keeps charging you until you cancel it yourself. Do that first: tap "Cancel Apple subscription" (if you also bought a custom domain, cancel that one too).\n\nDeleting removes your account, your website (it goes offline), its photos, your booking page, services, team and bookings. This can\'t be undone.';
export const DELETE_SUCCESS_MESSAGE = WEB
  ? 'Your account and website are deleted and your plan is canceled.'
  : 'Your account and website are deleted. Your Apple subscription is still active and will keep renewing until you cancel it.';
export const OFFLINE_ALERT_TITLE = 'Take your website offline?';
export const OFFLINE_ALERT_MESSAGE = `Your website goes offline and its photos are deleted. This can’t be undone.\n\n${SUBSCRIPTION_CONTINUES}`;
export const LOCAL_DELETE_MESSAGE = `This removes your website and settings from this phone only. A published website stays online until you use “Take my website offline”.\n\n${SUBSCRIPTION_CONTINUES}`;

/** The web has no Apple subscription: its Cancel-Apple button is left out there. */
export const SHOW_CANCEL_APPLE = Platform.OS !== 'web';
