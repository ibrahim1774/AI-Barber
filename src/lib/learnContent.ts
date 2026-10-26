/** What Prime Barber does for the barber, in plain words. Settings, Learn how it works: four collapsible sections, then one screen per topic. */
export type LearnSectionId = 'website' | 'bookings' | 'store' | 'settings';

export interface LearnSection {
  id: LearnSectionId;
  /** The header over the group on the list. */
  title: string;
}

export interface LearnTopic {
  /** The route param (/settings/learn/<slug>). Stable: deep links use it. */
  slug: string;
  section: LearnSectionId;
  /** Row title (one line) and the topic screen's title. */
  title: string;
  /** One short line on the topic screen, above the steps. */
  detail: string;
  /** Numbered steps. Every tab name and button label is copied from the app. */
  steps: string[];
}

export const LEARN_SECTIONS: LearnSection[] = [
  { id: 'website', title: 'Your custom website' },
  { id: 'bookings', title: 'Bookings' },
  { id: 'store', title: 'Your store' },
  { id: 'settings', title: 'Settings & what you can adjust' },
];

/** The list order. Within a section, "Next" follows this order and stops at the section's last topic. */
export const LEARN_TOPICS: LearnTopic[] = [
  // Your custom website
  { slug: 'intro', section: 'website', title: 'Quick tour',
    detail: 'The four tabs along the bottom of the app.',
    steps: [
      'Edit tab: your website. Tap any text or photo to change it, then tap Publish.',
      'Bookings tab: your calendar and customers. Tap Settings at the top to set up bookings.',
      'Store tab: Products, Orders and Customers for your shop.',
      'Settings tab: your account, plan, website link, team and payments.',
      'Open any topic below for the exact taps.',
    ] },
  { slug: 'editing', section: 'website', title: 'Edit text, photos and sections',
    detail: 'Your live site only changes when you tap Publish, so try things freely.',
    steps: [
      'Open the Edit tab. Your site is shown as a preview.',
      'Tap any text or photo in the preview to change it, then save.',
      'Or use the bar at the bottom. Tap Text to open All fields and edit any wording, or tap Photos to change any picture. Tap Done when finished.',
      'Tap Sections to open the list of blocks on your page (Services, Team, Hours, Gallery, About, Contact, Reviews).',
      'In Sections, switch a block on or off to show or hide it, use the move arrows to reorder, and tap its action (for example Edit text or Change image) to edit it. Tap Done.',
      'Tap Publish so visitors see your changes.',
    ] },
  { slug: 'buttons', section: 'website', title: 'Book and Call buttons',
    detail: 'Choose where each button on your site goes.',
    steps: [
      'Open the Edit tab and tap the button in the preview.',
      'Change the Button text if you like.',
      'On a Book button, choose Built-in scheduler (your Prime Barber booking page) or Booking link and type your own address.',
      'On a Call Now button, type the Phone number it should dial.',
      'Tap Save, then tap Publish at the bottom to update your live site.',
    ] },
  { slug: 'pages', section: 'website', title: 'Pages, design and colour',
    detail: 'Pick your pages, then the look of your site.',
    steps: [
      'Open the Edit tab and tap Pages at the bottom.',
      'Switch pages on or off, reorder them with the move arrows, and tap Add next to a page you want to include.',
      'On a single-page site, tap Make it multi-page to confirm. Then tap Save (or Done).',
      'In the preview, find the Design panel on the left. Tap Design 1 or Design 2 to switch the look. Your text and photos stay.',
      'Tap Theme in the panel under it, then tap a colour swatch.',
      'Tap Publish to put the new look on your live site.',
    ] },
  { slug: 'publish', section: 'website', title: 'Publish, share and your own address',
    detail: 'Go live, share your link, and add a .com of your own.',
    steps: [
      'Open the Edit tab and tap Publish. If you are asked to pick a plan, choose one to continue.',
      'When it finishes, your site is live.',
      'Open the Settings tab. Under Your website you will see your link with Open, Copy and Share.',
      'Tap Share your site for a message, a QR code and Instagram bio options.',
      'For your own address, find the Custom Domain card just below and tap Get yours (it says Manage once you have one).',
      'Type your shop name in the search box and tap Search. Pick a name marked Available and follow the steps to buy it.',
      'Your site must be published first. Come back to the same card to see the domain\'s status.',
    ] },

  // Bookings
  { slug: 'bookings-setup', section: 'bookings', title: 'Set up bookings',
    detail: 'Needs a free account and a plan that includes Bookings.',
    steps: [
      'Open the Bookings tab and tap Set up bookings. Tap Create account first if you are asked.',
      'Follow the first-run steps: Services, Hours, team, Get paid and your booking link. Tap Continue, or Skip this step, then Finish.',
      'Change anything later: in the Bookings tab tap Settings at the top (also found in the Settings tab under Bookings setup).',
      'Services: set each price, length and deposit. Barbers: tap Add a barber, then fill in Name and Role and choose services. Hours: pick a person, then set their week.',
      'Booking rules: set How far ahead people can book, Slots, Cancelling, your Address and Phone, and turn on Morning summary. Tap Save.',
      'Make sure Take bookings is on at the top of the setup list. Tap Copy my calendar link to see bookings in Apple or Google Calendar.',
    ] },
  { slug: 'calendar', section: 'bookings', title: 'Calendar and online booking',
    detail: 'Customers book from your site or link with no account. You manage it here.',
    steps: [
      'Open the Bookings tab. Tap Day, Week or Month at the top to change the view.',
      'Tap a booking to open it. You can Call, Text, mark it Done, Mark paid, No-show, Reschedule or Cancel booking.',
      'To add a walk-in, tap the round + button, then Add booking. Type a Name (and Phone), choose the service and time, then tap Add booking.',
      'To stop bookings while you are away, tap +, then Block time. Choose the time or All day, add a Reason if you like, then tap Block time.',
      'To get customers booking, tap Share at the top for your booking link, or publish a Book button on your site.',
      'Customers choose a service, a barber and a time, enter their details and book. Nothing to install. The booking then appears in your calendar.',
      'Tap Customers at the top to see everyone who has booked.',
    ] },
  { slug: 'payment-methods', section: 'bookings', title: 'Add payment methods',
    detail: 'Offer more than one way to pay. Store orders use the same list.',
    steps: [
      'Open the Bookings tab, tap Settings, then tap Get paid. (Also in the Settings tab: Get paid.)',
      'In the shop: switch on Customers pay when they arrive. No setup needed.',
      'Cash App, Venmo, Zelle, PayPal: type your handle in each box you use, then tap Save handles.',
      'Cards: under Card payments tap Connect cards with Stripe and follow the steps (about 5 minutes). If it was left half done, tap Finish setup with Stripe.',
      'Keep at least one way to pay switched on.',
    ] },
  { slug: 'get-paid', section: 'bookings', title: 'How to get paid',
    detail: 'What happens to the money for each way to pay.',
    steps: [
      'In the shop: you take the money yourself, however you do today.',
      'Cash App, Venmo, Zelle, PayPal: customers see your handle after they book and send the money themselves. Prime Barber doesn\'t move this money, so open the booking in the Bookings tab and tap Mark paid when it arrives. For a store order, open the order in Store, Orders and tap Mark paid.',
      'Cards: customers pay by card or Apple Pay and the money goes to your bank automatically.',
      'Prime Barber keeps the percentage shown on the Card payments card of each card payment, and Stripe charges its own processing fee on top. There is no monthly fee for cards.',
    ] },
  { slug: 'notifications', section: 'bookings', title: 'Notifications and reminders',
    detail: 'Get told about new bookings, orders and payments.',
    steps: [
      'Allow notifications for Prime Barber when your iPhone asks.',
      'If they are off, open the iPhone Settings app, tap Prime Barber, then Notifications, and allow them.',
      'For a daily summary: Bookings tab, Settings, Booking rules, switch on Morning summary, then tap Save. You get the day\'s bookings at 8:00.',
      'For reminders to publish: Settings tab, Notifications, switch Publish reminders on or off (up to 3 reminders).',
    ] },

  // Your store
  { slug: 'store', section: 'store', title: 'Open your shop and add products',
    detail: 'Photo, price, then take orders from the same site.',
    steps: [
      'Open the Store tab. The first time, tap Set up your shop (create a free account if asked).',
      'On the Store setup screen, set Pickup and Shipping (see Pickup, shipping and payments), tap Save, then tap Open my shop.',
      'Back in the Store tab, stay on Products and tap Add product.',
      'Tap Add photo, type a Name and Price, add a Description if you like, then tap Save.',
      'Switch on Sold out when an item runs out. Tap a product to edit or delete it.',
      'Publish your site once so the Shop link appears on your website.',
    ] },
  { slug: 'store-orders', section: 'store', title: 'Orders and customers',
    detail: 'Move each order along and see who buys from you.',
    steps: [
      'Open the Store tab and tap Orders. New orders show a count.',
      'Tap an order to see the items and the customer. You can Call, Text or Email them.',
      'Use the buttons to Mark paid, Mark ready (pickup), Mark shipped (add a Tracking number if you like) and Mark done.',
      'Tap Refund for a full or partial refund, or Cancel order. Orders you already took can always be fulfilled or refunded.',
      'Tap Customers to see everyone who ordered. Search by name, phone or email, or sort by Recent, Most orders, A\u2013Z or Spent.',
      'Tap a customer for their phone, email and full order history.',
    ] },
  { slug: 'store-shipping', section: 'store', title: 'Pickup, shipping and payments',
    detail: 'You need at least one of pickup or shipping before your shop can open.',
    steps: [
      'Open the Store tab and tap Settings at the top (Store setup).',
      'Switch on Offer pickup and type your Pickup instructions.',
      'Switch on Offer shipping, then enter a Flat shipping rate and Ships within (days). Tap Save.',
      'Tap Get paid to choose how customers pay (see Add payment methods).',
      'Tap Open my shop when you are ready, or Close my shop to pause orders. Tap Share at the top of the Store tab to send your shop link.',
    ] },

  // Settings & what you can adjust
  { slug: 'settings-account', section: 'settings', title: 'Account, plan and support',
    detail: 'Everything else in the Settings tab.',
    steps: [
      'Open the Settings tab. Under Account you see Signed in as. Tap Sign out to leave, or tap Sign in or Create account if you are not signed in.',
      'Under Subscription, tap Plan to see or upgrade it. Tap Restore purchases to bring back a plan bought with the same Apple ID.',
      'Tap Manage subscription to open your subscriptions in the App Store, where you can cancel.',
      'Under Notifications, switch Publish reminders on or off.',
      'Under Help, tap Privacy Policy or Terms of Service to read them, or tap Support to email support@davoxa.com.',
      'Your link, Bookings setup, Get paid and Your team are in the groups above these.',
    ] },
  { slug: 'team', section: 'settings', title: 'Team',
    detail: 'Add barbers so each has their own schedule. The number you can add depends on your plan.',
    steps: [
      'Open the Settings tab and tap Your team.',
      'Tap Add a barber.',
      'Type a Name and Role. Add a photo and a short bio if you like.',
      'Choose which services they do (or All services), then tap Add barber.',
      'Set their hours: Bookings tab, Settings, Hours, then tap their name.',
      'Customers can now choose who they book with. Tap a barber to edit them or tap Remove barber.',
    ] },
  { slug: 'settings-delete', section: 'settings', title: 'Take your website offline or delete your account',
    detail: 'Both are at the bottom of the Settings tab and ask you to confirm.',
    steps: [
      'Open the Settings tab and scroll to the bottom.',
      'Tap Take my website offline: your website goes offline and its photos are deleted. This can\'t be undone.',
      'Tap Delete account: your account, your website and its photos are deleted, and your site goes offline.',
      'Your subscription continues until you cancel it. Either prompt has a Manage subscription button that takes you there.',
      'Not signed in? Delete account instead removes your website and settings from this phone only.',
    ] },
];

export const topicFor = (slug: string | undefined): LearnTopic | undefined => LEARN_TOPICS.find((t) => t.slug === slug);

export const topicsIn = (section: LearnSectionId): LearnTopic[] => LEARN_TOPICS.filter((t) => t.section === section);

/** The next topic in the same section, or undefined at the section's end. */
export const nextInSection = (t: LearnTopic): LearnTopic | undefined => {
  const list = topicsIn(t.section);
  return list[list.indexOf(t) + 1];
};
