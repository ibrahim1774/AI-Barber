/** What Prime Barber does for the barber, in plain words. Settings, Learn how it works: a list, then one screen per topic. */
export type LearnVideoSlug = 'intro' | 'editing' | 'no-account' | 'calendar' | 'store' | 'domain' | 'notifications' | 'team';

export interface LearnTopic {
  slug: LearnVideoSlug;
  /** Row title and the topic screen's title. */
  title: string;
  /** The one-line description on the list row. */
  value: string;
  /** Two or three lines on the topic screen, under the video. */
  detail: string;
}

/** The list order: the quick tour first, then one topic per feature. Each slug matches a clip in assets/tutorial/. */
export const LEARN_TOPICS: LearnTopic[] = [
  { slug: 'intro', title: 'Quick tour', value: 'Everything you need to run your barbershop online, in one app.',
    detail: 'A short look at the whole app: your website, your bookings, your store and your team. Watch this first, then open any topic below for the detail.' },
  { slug: 'editing', title: 'Edit your site any time', value: 'Change any wording or photo whenever you like, then publish in one tap.',
    detail: 'Open the Edit tab and tap any text or photo to change it. Your website is not updated until you publish, so you can try things out first. Publishing takes one tap.' },
  { slug: 'no-account', title: 'Customers book without an account', value: 'They pick a time and book. No sign-up, no app to download.',
    detail: 'Customers choose a service and a time on your website and book straight away. They never need to sign up or download anything, so fewer of them give up halfway.' },
  { slug: 'calendar', title: 'A booking calendar built in', value: 'See your day, week and month, and add walk-ins or block time off.',
    detail: 'The Bookings tab shows your day, week and month. Add a walk-in in a few taps, or block off time when you are away, and customers will not be able to book it.' },
  { slug: 'store', title: 'Sell your own products', value: 'Add a photo and a price, then take orders for pickup or shipping from the same site.',
    detail: 'Add a product with a photo and a price and it appears on your website. Customers order for pickup or shipping, and you see every order in the Store tab.' },
  { slug: 'domain', title: 'Your own web address', value: 'Use a custom domain such as yourbarbershop.com.',
    detail: 'Give your website a web address of your own, like yourbarbershop.com. Customers find you more easily, and it looks more professional on cards and social profiles.' },
  { slug: 'notifications', title: 'Push notifications', value: 'Get a notification for every new booking, order and payment.',
    detail: 'Turn on notifications and your phone tells you the moment a customer books, orders or pays. You never need to keep checking the app.' },
  { slug: 'team', title: 'Your team', value: 'Add your barbers so each has their own schedule.',
    detail: 'Add each barber to your team. Every barber gets their own schedule, and customers can choose who they book with.' },
];

export const topicFor = (slug: string | undefined): LearnTopic | undefined => LEARN_TOPICS.find((t) => t.slug === slug);
