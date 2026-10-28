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

/** The support page shown (as a tappable link) in "Get help". The Learn screen opens it through SUPPORT_URL, like the rest of the app. */
const HELP_PAGE = 'www.aibarber.org/support';

/** The list order. Within a section, "Next" follows this order and stops at the section's last topic. Written for a complete beginner: one action per step. */
export const LEARN_TOPICS: LearnTopic[] = [
  // Your custom website
  { slug: 'intro', section: 'website', title: 'Quick tour',
    detail: 'The four tabs along the bottom of the app, and what each one is for.',
    steps: [
      'Look at the bottom of the screen. You will see four tabs: Edit, Bookings, Store and Settings.',
      'Tap the Edit tab. This is your website, shown as a preview.',
      'Tap any text or photo in the preview to change it. Nothing goes live until you tap Publish.',
      'Tap the Bookings tab. This is your calendar and your customers. Tap Settings at the top to set up bookings.',
      'Tap the Store tab. This is your shop, with Products, Orders and Customers.',
      'Tap the Settings tab. This is your account, plan, website link, team and payments.',
      'Open any topic in this Learn section for the exact taps.',
    ] },
  { slug: 'editing', section: 'website', title: 'Edit text, photos and sections',
    detail: 'Your live site only changes when you tap Publish, so try things freely.',
    steps: [
      'Tap the Edit tab. Your site appears as a preview.',
      'Tap any text or photo in the preview.',
      'Change it, then save.',
      'Or use the bar at the bottom. Tap Text to open All fields and edit any wording. Tap Done when finished.',
      'Tap Photos in the same bar to change any picture.',
      'Tap Sections to see the blocks on your page, such as Services, Team, Hours, Gallery, About, Contact and Reviews.',
      'Switch a block on or off to show or hide it.',
      'Use the move arrows to put blocks in a new order.',
      'Tap a block\'s action, for example Edit text or Change image, to edit it. Tap Done.',
      'Tap Publish so visitors see your changes.',
    ] },
  { slug: 'buttons', section: 'website', title: 'Book and Call buttons',
    detail: 'Choose where each button on your site goes.',
    steps: [
      'Tap the Edit tab.',
      'In the preview, tap the button you want to change.',
      'Change the Button text if you like.',
      'On a Book button, choose Built-in booking to use your Prime Barber booking page.',
      'Or choose Booking link and type your own address.',
      'On a Call Now button, type the Phone number it should dial.',
      'Tap Save.',
      'Tap Publish at the bottom to update your live site.',
    ] },
  { slug: 'pages', section: 'website', title: 'Pages, design and colour',
    detail: 'Pick your pages first, then the look of your site.',
    steps: [
      'Tap the Edit tab, then tap Pages at the bottom.',
      'Switch a page on or off to show or hide it.',
      'Use the move arrows to change the order.',
      'Tap Add next to a page you want to include.',
      'On a single-page site, tap Make it multi-page and confirm.',
      'Tap Save (or Done).',
      'In the preview, find the Design panel on the left. Tap Design 1 or Design 2 to switch the look. Your text and photos stay.',
      'Tap Theme in the panel under it, then tap a colour swatch.',
      'Tap Publish to put the new look on your live site.',
    ] },
  { slug: 'publish', section: 'website', title: 'Publish and share your site',
    detail: 'Go live, then send your link to customers.',
    steps: [
      'Tap the Edit tab, then tap Publish.',
      'If you are asked to pick a plan, choose one and follow Apple\'s prompt.',
      'If you are asked for an account, enter your details and tap Create Account & Publish (or Sign In & Publish).',
      'Not ready? Tap Back to return to the editor. Your payment is kept, and Publish brings you back to the same step.',
      'When it finishes, your site is live.',
      'Tap the Settings tab. Under Your website you will see your link with Open, Copy and Share.',
      'Tap Share your site for Send this link, Show QR code, Copy link and Copy for your Instagram bio.',
      'Change something later? Edit it, then tap Publish again.',
    ] },
  { slug: 'domain', section: 'website', title: 'Your own web address',
    detail: 'Replace the Prime Barber link with a .com of your own, like freshcuts.com.',
    steps: [
      'Publish your site first. A domain needs a live site.',
      'Tap the Settings tab.',
      'Find the Custom Domain card below your link and tap Get yours.',
      'Type your shop name in the Your shop name box and tap Search.',
      'Pick a name marked Available. Names marked Taken are not for sale.',
      'Follow the steps to buy it. The price is shown on the screen before you pay.',
      'Come back to the same card to see the domain\'s status. It says Manage once you own one.',
      'Not finding a name you like? Type a different spelling and tap Search again.',
    ] },

  // Bookings
  { slug: 'bookings-setup', section: 'bookings', title: 'Set up bookings',
    detail: 'Needs a free account and a plan that includes Bookings.',
    steps: [
      'Tap the Bookings tab.',
      'Tap Set up bookings. If you are asked, tap Create account first.',
      'Follow the first-run steps: Services, Hours, team, Get paid and your booking link.',
      'Tap Continue on each step, or Back to return to the one before. Add at least one service on the first step.',
      'Tap Finish at the end.',
      'Change anything later: in the Bookings tab tap Settings at the top. It is also in the Settings tab under Bookings setup.',
      'Check that Take bookings is on at the top of the setup list.',
      'Tap Copy my calendar link to see your bookings in Apple or Google Calendar.',
    ] },
  { slug: 'services-hours', section: 'bookings', title: 'Services, hours and booking rules',
    detail: 'Tell customers what you offer and when they can book.',
    steps: [
      'Tap the Bookings tab, then tap Settings at the top.',
      'Open Services. Set each price, length and deposit.',
      'Open Barbers. Tap Add a barber, fill in Name and Role, choose their services, then tap Add barber.',
      'Open Hours. Pick a person, then set their week.',
      'Open Booking rules. Set How far ahead people can book, Slots and Cancelling.',
      'Fill in your Address and Phone.',
      'Switch on Morning summary if you want a daily list of bookings.',
      'Tap Save.',
    ] },
  { slug: 'calendar', section: 'bookings', title: 'Calendar and online booking',
    detail: 'Customers book from your site or link with no account. You manage it here.',
    steps: [
      'Tap the Bookings tab.',
      'Tap Day, Week or Month at the top to change the view.',
      'Tap a booking to open it. You can Call, Text, mark it Done, Mark paid, No-show, Reschedule or Cancel booking.',
      'To add a walk-in, tap the round + button, then Add booking.',
      'Type a Name (and Phone), choose the service and time, then tap Add booking.',
      'To stop bookings while you are away, tap +, then Block time. Choose the time or All day, add a Reason if you like, then tap Block time.',
      'To get customers booking, tap Share at the top for your booking link, or publish a Book button on your site.',
      'Customers choose a service, a barber and a time, enter their details and book. Nothing to install. The booking then appears in your calendar.',
      'Tap Customers at the top to see everyone who has booked.',
    ] },
  { slug: 'payment-methods', section: 'bookings', title: 'Add payment methods',
    detail: 'Offer more than one way to pay. Store orders use the same list.',
    steps: [
      'Tap the Bookings tab, then Settings, then Get paid. It is also in the Settings tab: Get paid.',
      'To take payment in person, switch on Customers pay when they arrive. No setup needed.',
      'For Cash App, Venmo, Zelle or PayPal, type your handle in each box you use.',
      'Tap Save handles.',
      'For cards, find Card payments and tap Connect cards with Stripe.',
      'Follow Stripe\'s steps. They take about 5 minutes.',
      'If you stopped halfway, the button says Finish setup with Stripe. Tap it to continue.',
      'Keep at least one way to pay switched on.',
    ] },
  { slug: 'get-paid', section: 'bookings', title: 'How to get paid',
    detail: 'What happens to the money for each way to pay.',
    steps: [
      'In the shop: you take the money yourself, however you do today.',
      'Cash App, Venmo, Zelle, PayPal: customers see your handle after they book and send the money themselves.',
      'Prime Barber doesn\'t move this money. When it arrives, open the booking in the Bookings tab and tap Mark paid.',
      'For a store order, open the order in Store, Orders and tap Mark paid.',
      'Cards: customers pay by card or Apple Pay. The money goes to your own Stripe account.',
      'Stripe sends payouts to your bank on the schedule you set in your Stripe Dashboard. Disputes and payout holds are handled there too.',
      'Prime Barber charges the percentage shown on the Card payments card. Stripe charges you its own processing fee as well.',
      'A refund returns Prime Barber\'s fee proportionally, not Stripe\'s fee. A refund made directly in the Stripe Dashboard does not return Prime Barber\'s fee.',
      'There is no monthly fee for cards.',
    ] },
  { slug: 'notifications', section: 'bookings', title: 'Notifications and reminders',
    detail: 'Get told about new bookings, orders and payments.',
    steps: [
      'Tap Allow when your iPhone asks about notifications for Prime Barber.',
      'If you said no, open the iPhone Settings app and tap Prime Barber.',
      'Tap Notifications and allow them.',
      'For a daily summary, tap the Bookings tab, then Settings, then Booking rules.',
      'Switch on Morning summary and tap Save. You get the day\'s bookings at 8:00.',
      'For reminders to publish, tap the Settings tab, find Notifications, and switch Publish reminders on or off. You get up to 3 reminders.',
    ] },

  // Your store
  { slug: 'store', section: 'store', title: 'Open your shop and add products',
    detail: 'Photo, price, then take orders from the same site.',
    steps: [
      'Tap the Store tab.',
      'The first time, tap Set up your shop. Create a free account if you are asked.',
      'On the Store setup screen, choose Pickup and Shipping. The next topic shows how.',
      'Tap Save, then tap Open my shop.',
      'Back in the Store tab, stay on Products and tap Add product.',
      'Tap Add photo and choose a picture.',
      'Type a Name and a Price. Add a Description if you like.',
      'Tap Save.',
      'Switch on Sold out when an item runs out. Tap a product any time to edit or delete it.',
      'Tap the Edit tab, then Publish once, so the Shop link appears on your website.',
    ] },
  { slug: 'store-shipping', section: 'store', title: 'Pickup and shipping',
    detail: 'You need at least one of pickup or shipping before your shop can open.',
    steps: [
      'Tap the Store tab, then tap Settings at the top. This is Store setup.',
      'To let customers collect from you, switch on Offer pickup.',
      'Type your Pickup instructions, for example where to ask.',
      'To post orders, switch on Offer shipping.',
      'Enter a Flat shipping rate. It is one rate per order.',
      'Enter Ships within (days).',
      'Tap Save.',
      'Tap Open my shop when you are ready, or Close my shop to pause orders.',
    ] },
  { slug: 'store-payments', section: 'store', title: 'Payments',
    detail: 'How customers pay for shop orders, and how the money reaches you.',
    steps: [
      'Tap the Store tab, then tap Settings at the top.',
      'Tap Get paid to choose how customers can pay.',
      'Switch on Customers pay when they arrive to take payment in person.',
      'Type your Cash App, Venmo, Zelle or PayPal handle and tap Save handles. Customers see it and send the money to you.',
      'For cards, tap Connect cards with Stripe and follow the steps. Card money goes to your own Stripe account, and Stripe sends payouts to your bank on the schedule you set in your Stripe Dashboard.',
      'Prime Barber charges the percentage shown on the Card payments card, and Stripe charges you its own fee. A refund made directly in the Stripe Dashboard does not return Prime Barber\'s fee.',
      'When a customer pays you outside the app, open the order in Orders and tap Mark paid.',
      'Keep at least one way to pay switched on.',
    ] },
  { slug: 'store-orders', section: 'store', title: 'Orders and customers',
    detail: 'Move each order along and see who buys from you.',
    steps: [
      'Tap the Store tab, then tap Orders. New orders show a count.',
      'Tap an order to see the items and the customer.',
      'Tap Call, Text or Email to contact the customer.',
      'Tap Mark paid when you have been paid.',
      'For pickup, tap Mark ready. For shipping, tap Mark shipped and add a Tracking number if you like.',
      'Tap Mark done when the order is finished.',
      'Tap Refund for a full or partial refund, or Cancel order.',
      'Tap Customers to see everyone who ordered. Search by name, phone or email, or sort by Recent, Most orders, A–Z or Spent.',
      'Tap a customer for their phone, email and full order history.',
    ] },

  // Settings & what you can adjust
  { slug: 'settings-account', section: 'settings', title: 'Your account',
    detail: 'Sign in, create an account or sign out.',
    steps: [
      'Tap the Settings tab. The first group is Account.',
      'If you are signed in, it shows Signed in as with your email.',
      'To leave, tap Sign out.',
      'If you are not signed in, tap Sign in, or tap Create account.',
      'To create one, enter your Email and a Password. Full Name and Phone Number are optional.',
      'If you see Check your email, open the email we sent and confirm, then sign in.',
      'Forgot your password? On the sign-in screen tap Forgot password?',
      'Your website is saved to your account, so you can sign in on a new phone.',
    ] },
  { slug: 'settings-plan', section: 'settings', title: 'Plan and subscription',
    detail: 'Upgrade, cancel, restore a purchase, or move a subscription between accounts.',
    steps: [
      'Tap the Settings tab and find the Subscription group.',
      'Tap Plan to see your plan. A menu called Your plan opens.',
      'Tap Upgrade to Bookings or Upgrade to Store to add one, then follow Apple\'s prompt.',
      'Tap Manage subscription to open your subscriptions in the App Store. Cancel or downgrade there.',
      'New phone or reinstalled app? Sign in, then tap Restore purchases. Use the same Apple ID you paid with.',
      'A subscription is tied to your Apple ID, so only one Prime Barber account can use it at a time.',
      'If it is on another account, the app says so. Tap Move subscription to this account and confirm.',
      'You can find that button on the Choose an account screen, on a locked Bookings or Store tab, and in the Restore purchases message.',
      'Or sign in to the other account instead.',
    ] },
  { slug: 'team', section: 'settings', title: 'Team',
    detail: 'Add barbers so each has their own schedule. How many depends on your plan.',
    steps: [
      'Tap the Settings tab, then tap Your team.',
      'Tap Add a barber.',
      'Type a Name and Role.',
      'Add a photo and a short bio if you like.',
      'Choose which services they do, or All services.',
      'Tap Add barber.',
      'Set their hours: Bookings tab, Settings, Hours, then tap their name.',
      'Customers can now choose who they book with.',
      'Tap a barber to edit them, or tap Remove barber.',
    ] },
  { slug: 'settings-adjust', section: 'settings', title: 'What you can adjust',
    detail: 'Where each setting lives, so you can find it fast.',
    steps: [
      'Website look and wording: Edit tab, using Text, Photos, Sections and Pages.',
      'Your link: Settings tab, Your website, with Open, Copy and Share.',
      'Your own address: Settings tab, Custom Domain.',
      'Services, hours and booking rules: Bookings tab, Settings (also Settings tab, Bookings setup).',
      'Ways to get paid: Settings tab, Get paid.',
      'Pickup, shipping and shop open or closed: Store tab, Settings.',
      'Barbers: Settings tab, Your team.',
      'Publish reminders: Settings tab, Notifications.',
      'Plan and subscription: Settings tab, Subscription.',
    ] },
  { slug: 'settings-delete', section: 'settings', title: 'Take your website offline or delete your account',
    detail: 'Both are at the bottom of the Settings tab and ask you to confirm.',
    steps: [
      'Tap the Settings tab and scroll to the bottom.',
      'To hide your site, tap Take my website offline, then confirm with Take offline. Your site goes offline and its photos are deleted. This can\'t be undone.',
      'To remove everything, tap Delete account, then confirm with Delete account. Your account, your website and its photos are deleted, and your site goes offline.',
      'Your subscription continues until you cancel it. Each confirmation has a Manage subscription button that takes you there.',
      'Not signed in? Delete account instead removes your website and settings from this phone only (Delete data on this phone).',
      'Changed your mind? Tap Cancel.',
    ] },
  { slug: 'help', section: 'settings', title: 'Get help',
    detail: 'Stuck? Our support team will help.',
    steps: [
      'First, open the Learn topic that matches what you are doing.',
      `Visit our support page: https://${HELP_PAGE}`,
      'Or email us: support@davoxa.com',
      'In the app, tap the Settings tab. Under Help, tap Support to write to us.',
      'Stuck on the account step? Tap Need help? Contact support at the bottom of the screen.',
      'Tell us what you were doing, what you saw, and the email you signed up with. Never send your password.',
      'Under Help you can also read the Privacy Policy and Terms of Service.',
    ] },
];

export const topicFor = (slug: string | undefined): LearnTopic | undefined => LEARN_TOPICS.find((t) => t.slug === slug);

export const topicsIn = (section: LearnSectionId): LearnTopic[] => LEARN_TOPICS.filter((t) => t.section === section);

/** The next topic in the same section, or undefined at the section's end. */
export const nextInSection = (t: LearnTopic): LearnTopic | undefined => {
  const list = topicsIn(t.section);
  return list[list.indexOf(t) + 1];
};
