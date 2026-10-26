/** What Prime Barber does for the barber, in plain words. Settings, Learn how it works: grouped sections, then one screen per topic. */
export type LearnVideoSlug = 'intro' | 'editing' | 'no-account' | 'calendar' | 'store' | 'domain' | 'notifications' | 'team';
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
  /** Row title and the topic screen's title. */
  title: string;
  /** The one-line description on the list row. */
  value: string;
  /** One or two lines on the topic screen, above the steps. */
  detail: string;
  /** Three to six short steps, shown numbered. */
  steps: string[];
  /** Only set where a clip in assets/tutorial/ matches this topic. */
  video?: LearnVideoSlug;
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
  { slug: 'intro', section: 'website', video: 'intro', title: 'Quick tour', value: 'Everything you need to run your barbershop online, in one app.',
    detail: 'A short look at the whole app: your website, your bookings, your store and your team. Watch this first, then open any topic for the detail.',
    steps: [
      'The Edit tab is your website. Change its text and photos, then tap Publish.',
      'The Bookings tab is your calendar and your customers.',
      'The Store tab is for products and orders.',
      'The Settings tab holds your account, plan, link and everything else you can adjust.',
    ] },
  { slug: 'editing', section: 'website', video: 'editing', title: 'Edit text and photos', value: 'Change any wording or photo whenever you like, then publish in one tap.',
    detail: 'Your live website only changes when you publish, so you can try things out first.',
    steps: [
      'Open the Edit tab.',
      'Tap any text or photo on your site to change it.',
      'Or use the bar at the bottom: Text lists every text field, Photos lists every photo.',
      'Tap Publish when you are happy.',
    ] },
  { slug: 'buttons', section: 'website', title: 'Buttons and menu', value: 'Choose what the Book and Call Now buttons do.',
    detail: 'Tap a button on your site in the Edit tab to open its settings.',
    steps: [
      'Open the Edit tab and tap the button you want to change.',
      'Change the button text.',
      'On a Book button, choose where it goes: the built-in scheduler, or your own booking link.',
      'On a Call Now button, enter the phone number it dials.',
      'Tap Save, then Publish to update your live site.',
    ] },
  { slug: 'sections-services', section: 'website', title: 'Sections and services', value: 'Add, remove and edit the parts of your site.',
    detail: 'Sections are the blocks on your page, such as services, team, hours, gallery, about, reviews and contact.',
    steps: [
      'In the Edit tab, tap Sections at the bottom.',
      'Tap a section to edit it, for example Services for your prices.',
      'Tap Done when you have finished.',
      'Tap Publish so visitors see the change.',
    ] },
  { slug: 'pages', section: 'website', title: 'Pages', value: 'Pick, add, hide and reorder the pages on your website.',
    detail: 'A multi-page site gives each topic its own page, such as services or about.',
    steps: [
      'In the Edit tab, tap Pages at the bottom.',
      'Turn pages on or off, and reorder them.',
      'Tap Add next to a page you want to include.',
      'Tap Save, then Publish.',
    ] },
  { slug: 'design-theme', section: 'website', title: 'Design and theme', value: 'Switch between two designs and pick your colour.',
    detail: 'Both designs use your own text and photos, so you can switch back and forth.',
    steps: [
      'Open the Edit tab and find the Design control.',
      'Tap Design 1 or Design 2 to switch the look.',
      'Tap Theme and pick a colour.',
      'Tap Publish to put the new look on your live site.',
    ] },
  { slug: 'publish', section: 'website', title: 'Publish your site', value: 'Put your changes on the live website.',
    detail: 'Nothing on your live site changes until you publish.',
    steps: [
      'Tap Publish in the Edit tab.',
      'If you are asked to pick a plan, choose one to continue.',
      'When it finishes, your site is live.',
      'Find your link under Your website in Settings, with Open, Copy and Share.',
    ] },
  { slug: 'domain', section: 'website', video: 'domain', title: 'Your own web address', value: 'Use a custom domain such as yourbarbershop.com.',
    detail: 'Give your website an address of your own. It is a .com that is linked to your site for you.',
    steps: [
      'Open Settings and find the Custom Domain card under Your website.',
      'Tap Get yours.',
      'Type the name you want and tap Search.',
      'Pick a name marked Available and follow the steps to buy it.',
      'Come back to the same card to see its status.',
    ] },

  // Bookings
  { slug: 'bookings-setup', section: 'bookings', title: 'Set up bookings', value: 'Hours, services and team in a few minutes.',
    detail: 'Bookings need a free account and a plan that includes Bookings.',
    steps: [
      'Open the Bookings tab and tap Settings (the gear).',
      'Follow the first-run setup, or open Services, Barbers and Hours from the list.',
      'Services: set prices, lengths and deposits.',
      'Barbers: add anyone who takes bookings. Hours: set each person\'s week.',
      'Make sure Take bookings is on.',
    ] },
  { slug: 'calendar', section: 'bookings', video: 'calendar', title: 'Your booking calendar', value: 'See your day, week and month, and add walk-ins or block time off.',
    detail: 'The Bookings tab shows everything that is booked.',
    steps: [
      'Open the Bookings tab and switch between day, week and month.',
      'Tap a booking to call, text, mark it done, reschedule or cancel.',
      'Tap the add button, then Add booking for a walk-in.',
      'Or tap Block time to stop customers booking while you are away.',
    ] },
  { slug: 'no-account', section: 'bookings', video: 'no-account', title: 'Customers book without an account', value: 'They pick a time and book. No sign-up, no app to download.',
    detail: 'Customers book from your website or your booking link.',
    steps: [
      'Tap Share in the Bookings tab to send your booking link, or add a Book button to your site.',
      'The customer chooses a service, a barber and a time.',
      'They enter their details and book. Nothing to install.',
      'The booking appears in your calendar.',
    ] },
  { slug: 'notifications', section: 'bookings', video: 'notifications', title: 'Notifications for new bookings', value: 'Get a notification for every new booking, order and payment.',
    detail: 'Your phone tells you the moment a customer books.',
    steps: [
      'Allow notifications for Prime Barber on your iPhone.',
      'If they are off, open the iPhone Settings app, then Prime Barber, then Notifications.',
      'In Bookings Settings, Booking rules, switch on the Morning summary for a notification at 8:00 with the day\'s bookings.',
    ] },
  { slug: 'payment-methods', section: 'bookings', title: 'Add payment methods', value: 'Choose how customers can pay you for bookings.',
    detail: 'You can offer more than one way to pay.',
    steps: [
      'Open the Bookings tab, tap Settings, then Get paid.',
      'In the shop: customers pay when they arrive. No setup needed.',
      'Cash App, Venmo, Zelle, PayPal: type your handle for each one you use, then tap Save handles.',
      'Cards: tap Connect cards with Stripe and follow the steps. It takes about 5 minutes.',
      'You always need to keep at least one way to pay switched on.',
    ] },
  { slug: 'get-paid', section: 'bookings', title: 'How to get paid', value: 'What happens to the money for each way to pay.',
    detail: 'The same Get paid screen is used for bookings and for your store.',
    steps: [
      'In the shop: you take the money yourself, however you do today.',
      'Cash App, Venmo, Zelle, PayPal: customers see your handle after they book and send the money themselves. Prime Barber doesn\'t move this money, so tap Mark paid when it arrives.',
      'Cards: customers pay by card or Apple Pay and the money goes to your bank automatically.',
      'Prime Barber keeps the percentage shown on the Card payments card of each card payment, and Stripe charges its own processing fee on top. There is no monthly fee for cards.',
    ] },

  // Your store
  { slug: 'store', section: 'store', video: 'store', title: 'Add products', value: 'Add a photo and a price, then take orders from the same site.',
    detail: 'Products appear on your website once your shop is open.',
    steps: [
      'Open the Store tab. If you have not set it up, follow the prompt to open your shop.',
      'On Products, add a product with a name, price, photo and an optional description.',
      'Turn on Sold out when an item runs out.',
      'Tap Settings (the gear), then Open my shop. Customers can then browse and order.',
    ] },
  { slug: 'store-orders', section: 'store', title: 'Orders', value: 'See new orders and move each one along.',
    detail: 'Orders you have already taken can always be fulfilled or refunded.',
    steps: [
      'Open the Store tab and tap Orders. New orders show a count.',
      'Tap an order to see what was bought and how to reach the customer.',
      'Use the buttons to Mark paid, Mark ready, Mark shipped (add tracking if you like) and Mark done.',
      'Use Refund for a full or partial refund, or Cancel order.',
    ] },
  { slug: 'store-customers', section: 'store', title: 'Store customers', value: 'Everyone who has ordered, with what they spent and owe.',
    detail: 'Each customer shows how many orders they made, what they spent and anything they still owe.',
    steps: [
      'Open the Store tab and tap Customers.',
      'Search by name, or sort by Recent, Most orders, A–Z or Spent.',
      'A line such as Owes shows when an order is unpaid.',
      'Tap a customer to see their phone, email and full order history.',
    ] },
  { slug: 'store-payments', section: 'store', title: 'Store payments', value: 'Choose how customers pay for orders.',
    detail: 'Store orders use the same Get paid choices as bookings.',
    steps: [
      'Open the Store tab, tap Settings, then Get paid.',
      'Choose in the shop, Cash App, Venmo, Zelle, PayPal, or cards with Stripe.',
      'For handles, tap Mark paid on the order when the money arrives.',
      'Cards go to your bank automatically. See How to get paid for the fee.',
    ] },
  { slug: 'store-shipping', section: 'store', title: 'Pickup and shipping', value: 'Offer pickup, shipping or both.',
    detail: 'You need at least one of them on before you can open your shop.',
    steps: [
      'Open the Store tab and tap Settings.',
      'Turn on Offer pickup and add pickup instructions.',
      'Turn on Offer shipping, then set a flat rate and how many days you ship within.',
      'Tap Save.',
    ] },

  // Settings & what you can adjust
  { slug: 'settings-account', section: 'settings', title: 'Account and sign-in', value: 'Sign in, sign out, your plan and restoring purchases.',
    detail: 'The Account and Subscription groups at the top of Settings.',
    steps: [
      'Account shows the email you are signed in with. Tap Sign out to leave. Not signed in? Tap Sign in or Create account.',
      'Plan shows what you have. Tap it to upgrade, or to go to Manage subscription.',
      'Restore purchases brings back a plan bought with the same Apple ID.',
      'Manage subscription opens your subscriptions in the App Store, where you can cancel.',
    ] },
  { slug: 'settings-website', section: 'settings', title: 'Your website and domain', value: 'Your live link, sharing and your custom domain.',
    detail: 'The Your website group shows your shop name, whether you are live, and your link.',
    steps: [
      'Tap Open, Copy or Share to use your link.',
      'If your site is not live yet, tap Publish.',
      'If your plan has lapsed, tap Renew to put your site back.',
      'Use the Custom Domain card to get or manage your own address.',
      'Share your site opens a message, QR code and Instagram bio options.',
    ] },
  { slug: 'settings-bookings', section: 'settings', title: 'Bookings setup', value: 'Services, barbers, hours and booking rules.',
    detail: 'The same screens you reach from the gear in the Bookings tab.',
    steps: [
      'Tap Bookings setup. Take bookings turns your booking page on or off.',
      'Services holds prices, lengths and deposits. Hours sets each person\'s week.',
      'Booking rules covers how far ahead people can book, notice, gaps between bookings and cancelling.',
      'Copy a calendar link to see your bookings in Apple or Google Calendar.',
    ] },
  { slug: 'settings-store', section: 'settings', title: 'Store and payments', value: 'Get paid, and how your shop is set up.',
    detail: 'Payments are shared by bookings and your store.',
    steps: [
      'Tap Get paid to choose in the shop, Cash App, Venmo, Zelle, PayPal, or cards.',
      'Pickup, shipping and opening or closing your shop are in the Store tab, under Settings.',
      'Products, Orders and Customers are in the Store tab itself.',
    ] },
  { slug: 'team', section: 'settings', video: 'team', title: 'Team', value: 'Add your barbers so each has their own schedule.',
    detail: 'The number of barbers you can add depends on your plan.',
    steps: [
      'Open Settings and tap Your team.',
      'Tap Add a barber and enter a name and role.',
      'Choose which services they do, and their hours.',
      'Customers can then choose who they book with. Tap a barber to edit or remove them.',
    ] },
  { slug: 'settings-notifications', section: 'settings', title: 'Notifications and reminders', value: 'Publish reminders and booking alerts.',
    detail: 'Reminders only go out if you allow notifications.',
    steps: [
      'In Settings, switch Publish reminders on or off. It sends up to 3 reminders to publish your site.',
      'If you are asked to allow notifications, tap Open Settings and allow Prime Barber.',
      'For a daily summary of bookings, use Morning summary under Booking rules.',
    ] },
  { slug: 'settings-legal', section: 'settings', title: 'Privacy, terms and support', value: 'Policies and how to reach us.',
    detail: 'The Help group at the bottom of Settings.',
    steps: [
      'Tap Privacy Policy or Terms of Service to read them in the app.',
      'Tap Support to email support@davoxa.com.',
      'The app version is shown at the very bottom, handy if you write to us.',
    ] },
  { slug: 'settings-delete', section: 'settings', title: 'Delete account or take your website offline', value: 'Remove your website, or your whole account.',
    detail: 'Both are at the bottom of Settings and ask you to confirm. You can cancel at the prompt.',
    steps: [
      'Take my website offline: your website goes offline and its photos are deleted. This can\'t be undone.',
      'Delete account: your account, your website and its photos are deleted, and your site goes offline.',
      'Your subscription continues until you cancel it in Manage subscription. Either prompt has a button that takes you there.',
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
