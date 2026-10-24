// A rich fixture: every section and every page on, for the editable-everywhere audit.
import type { WebsiteData } from '../../../types';

const svc = (title: string, extra: Record<string, unknown> = {}) => ({ title, subtitle: '', description: '', icon: 'scissors' as const, imageUrl: '', ...extra });

export const RICH_SITE: WebsiteData = {
  shopName: 'Fresh Cuts', area: 'Brooklyn, NY', phone: '(512) 555-0100', bookingUrl: '/book', shopUrl: '/shop', template: 'luxe',
  hero: { heading: 'Fresh Cuts', tagline: 'Sharp fades, hot towels, no wait.', imageUrl: '' },
  about: { heading: 'About Fresh Cuts', description: ['We have cut hair on this corner for ten years.', 'Walk in or book ahead.'], imageUrl: '' },
  services: [
    svc('Skin Fade', { price: '$35', duration: '45 min', category: 'Haircuts', subtitle: 'Clean and sharp', description: 'A skin fade with a hot towel finish.' }),
    svc('Taper', { price: '$30', description: 'A classic taper.' }),
    svc('Beard Trim', { price: '$15', description: 'Shaped and lined.' }),
    svc('Kids Cut', { price: '$20' }),
    svc('Hot Towel Shave', { price: '$30' }),
    svc('Facial'),
  ],
  gallery: ['g0', 'g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7'].map((x) => `https://img.example.com/${x}.jpg`),
  hours: [
    { day: 'Mon', open: '09:00', close: '17:00' }, { day: 'Tue', open: '09:00', close: '17:00' },
    { day: 'Wed', open: '09:00', close: '17:00' }, { day: 'Sun', open: '', close: '', closed: true },
  ],
  contact: { address: '1 Main St, Brooklyn, NY 11201', email: 'hello@freshcuts.example.com' },
  reviews: [
    { author: 'Sam T.', rating: 5, comment: 'Best fade in the borough.', date: '2026-08-01' },
    { author: 'Lee K.', rating: 4, comment: 'Quick and friendly.', date: '2026-07-02' },
  ],
  reviewsSource: 'Google',
  aggregateRating: { rating: 4.8, count: 120 },
  staff: [
    { name: 'Sam Fade', role: 'Owner and master barber', photo: 'https://img.example.com/sam.jpg', bio: 'Sam has been cutting for twelve years.', serviceNames: ['Skin Fade', 'Taper'], serviceIds: ['a', 'b'],
      hours: [{ day: 'Mon', open: '09:00', close: '17:00' }, { day: 'Sun', open: '', close: '', closed: true }] },
    { name: 'Alex Line', role: 'Barber', photo: 'https://img.example.com/alex.jpg', bio: 'Alex does beards.' },
    { name: 'Jo Park', role: 'Barber', memberId: '0b6f2d1e-3c4a-4b8e-9d11-5a7c2e9f0a42', bio: 'Jo takes the early chair.' },
  ],
  bio: 'A neighbourhood shop with a loyal crowd and a calm chair.',
  featureCards: [{ title: 'Hot towel', sub: 'With every cut' }, { title: 'Late hours', sub: 'Open until nine on Fridays' }],
  policy: { title: 'Please note', body: 'Walk-ins welcome when we have a chair free.' },
  pullQuote: { text: 'Look sharp, feel sharp.', accent: 'Every time.' },
  pages: { order: [], hidden: [] },
  extraPages: { on: ['faq', 'first-visit', 'hair-care', 'beard-care'], serviceGuides: true, seed: 11 },
} as WebsiteData;

/** Short values everywhere: a length rule that counts the editor markers would decide differently from the published page. */
export const SHORT_SITE: WebsiteData = {
  ...RICH_SITE,
  shopName: 'Ace', area: 'Austin, TX', phone: '555-0100', bio: 'Short bio here ok.',
  hero: { heading: 'Ace', tagline: 'Fades.', imageUrl: '' },
  about: { heading: 'Hi', description: ['One.'], imageUrl: '' },
  services: [svc('Fade', { price: '25', duration: '30 min' }), svc('Taper', { price: '20' }), svc('Beard Trim', { price: '10' })],
  contact: { address: 'main street, Austin, TX', email: 'a@b.co' },
  staff: [{ name: 'Al', role: 'Pro', bio: 'Hi.' }],
  hours: [{ day: 'Mon', open: '9', close: '5' }, { day: 'Tue', open: '9am', close: '5pm' }],
  policy: { title: 'Note', body: 'Be on time.' },
  pullQuote: { text: 'Sharp.' },
} as WebsiteData;

/** The booking and shop links are other sites (new-tab buttons), and no booking member: the other button variants. */
export const EXTERNAL_SITE: WebsiteData = {
  ...RICH_SITE,
  bookingUrl: 'https://booksy.com/en-us/123_fresh-cuts', shopUrl: 'https://shop.example.com',
} as WebsiteData;

/** Only the bare minimum the renderer needs: every fallback wording a design prints when the barber left a field empty. */
export const SPARSE_SITE: WebsiteData = {
  shopName: 'Ace Barbers', area: 'Austin, TX', phone: '', bookingUrl: '', template: 'luxe',
  hero: { heading: '', tagline: '', imageUrl: '' },
  about: { heading: '', description: [], imageUrl: '' },
  services: [svc('Fade', { price: '25' })],
  gallery: [], contact: { address: '', email: '' }, pages: { order: [], hidden: [] },
} as WebsiteData;

/** Another kind of business: the wording that depends on the niche. */
export const NAILS_SITE: WebsiteData = { ...RICH_SITE, niche: 'nails', shopName: 'Polish Studio' } as WebsiteData;
