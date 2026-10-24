import type { TourId } from '@/components/tutorial/tours';

export type TutorialSlug = 'site-editing' | 'bookings' | 'store' | 'adding-products' | 'getting-paid';

export interface TutorialTopic {
  slug: TutorialSlug;
  title: string;
  /** One line under the title on the list. */
  blurb: string;
  /** The in-app arrow tour the "Show me with arrows" button starts. */
  tour: TourId;
  /** Plain, short steps that match what the app does today. */
  steps: string[];
}

export const TUTORIAL_TOPICS: TutorialTopic[] = [
  {
    slug: 'site-editing', title: 'Site editing', blurb: 'Change wording, pictures and colour, then publish.', tour: 'edit',
    steps: [
      'Open the Edit tab. Your website shows as a preview.',
      'Tap Text, then the wording you want to change.',
      'Tap Change image on a picture to swap it. Photos lists them all.',
      'Tap Colour to pick the accent colour for your site.',
      'Tap Publish to put your changes online. Publish again after each edit.',
    ],
  },
  {
    slug: 'bookings', title: 'Bookings', blurb: 'See your day and add or block time.', tour: 'bookings',
    steps: [
      'Open the Bookings tab. Switch between Day, Week and Month at the top.',
      'Tap + to add a booking for a walk-in, or to block time off.',
      'Tap an appointment to see its details.',
      'Tap Setup to set your services, barbers and opening hours.',
    ],
  },
  {
    slug: 'store', title: 'Your store', blurb: 'Set up pickup or shipping and open your shop.', tour: 'store',
    steps: [
      'Open the Store tab. The store is part of the Store plan.',
      'Tap Setup. Turn on pickup, shipping or both. Shipping is one flat rate per order.',
      'Tap Save, then Open my shop. Close it the same way any time.',
      'Share your shop link from Setup so customers can find it.',
      'Orders that come in appear under Orders.',
    ],
  },
  {
    slug: 'adding-products', title: 'Adding products', blurb: 'Add a product with a photo and a price.', tour: 'store',
    steps: [
      'Open the Store tab, then Products.',
      'Tap Add product.',
      'Add a photo from your camera or library. The first photo is the cover.',
      'Type a name and a price in dollars. A description is optional.',
      'Tap Save. Tap a product later to edit it or mark it Sold out.',
    ],
  },
  {
    slug: 'getting-paid', title: 'Getting paid', blurb: 'Choose how customers pay you.', tour: 'getpaid',
    steps: [
      'Open Settings, then Get paid. Set up bookings first if you have not.',
      'In the shop: leave it on if customers pay when they arrive.',
      'Type your Cash App, Venmo, Zelle or PayPal handle, then tap Save handles.',
      'For cards, tap Connect cards with Stripe and finish the steps on Stripe’s page.',
      'Keep at least one way to pay turned on.',
    ],
  },
];

export const topicBySlug = (slug: string | undefined): TutorialTopic | undefined =>
  TUTORIAL_TOPICS.find((t) => t.slug === slug);
