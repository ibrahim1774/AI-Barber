// A rich fixture: every section and every page on, for the editable-everywhere audit.
import type { WebsiteData } from '../../../types';

const svc = (title: string, extra: Record<string, unknown> = {}) => ({ title, subtitle: '', description: '', icon: 'scissors' as const, imageUrl: '', ...extra });

export const RICH_SITE: WebsiteData = {
  shopName: 'Fresh Cuts', area: 'Brooklyn, NY', phone: '(512) 555-0100', bookingUrl: '/book', shopUrl: '/shop', template: 'luxe',
  hero: { heading: 'Fresh Cuts', tagline: 'Sharp fades, hot towels, no wait.', imageUrl: '' },
  about: { heading: 'About Fresh Cuts', description: ['We have cut hair on this corner for ten years.', 'Walk in or book ahead.'], imageUrl: '' },
  services: [
    svc('Skin Fade', { price: '$35', duration: '45 min', subtitle: 'Clean and sharp', description: 'A skin fade with a hot towel finish.' }),
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
  ],
  policy: { title: 'Please note', body: 'Walk-ins welcome when we have a chair free.' },
  pullQuote: { text: 'Look sharp, feel sharp.' },
  pages: { order: [], hidden: [] },
  extraPages: { on: ['faq', 'first-visit', 'hair-care', 'beard-care'], serviceGuides: true, seed: 11 },
} as WebsiteData;
