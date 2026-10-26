/** What Prime Barber does for the barber, in plain words. Shown on Settings, Learn how it works. */
export interface LearnFeature {
  slug: string;
  title: string;
  value: string;
}

export const LEARN_FEATURES: LearnFeature[] = [
  { slug: 'editing', title: 'Edit your site any time', value: 'Change any wording or photo whenever you like, then publish in one tap.' },
  { slug: 'no-account', title: 'Customers book without an account', value: 'They pick a time and book. No sign-up, no app to download.' },
  { slug: 'calendar', title: 'A booking calendar built in', value: 'See your day, week and month, and add walk-ins or block time off.' },
  { slug: 'store', title: 'Sell your own products', value: 'Add a photo and a price, then take orders for pickup or shipping from the same site.' },
  { slug: 'domain', title: 'Your own web address', value: 'Use a custom domain such as yourbarbershop.com.' },
  { slug: 'notifications', title: 'Push notifications', value: 'Get a notification for every new booking, order and payment.' },
  { slug: 'team', title: 'Your team', value: 'Add your barbers so each has their own schedule.' },
];

/** Slugs of the clips that sit in assets/tutorial/: 'intro' is shown first, then one per feature above. */
export type LearnVideoSlug = 'intro' | 'editing' | 'no-account' | 'calendar' | 'store' | 'domain' | 'notifications' | 'team';
