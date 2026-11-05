// Sites shaped like the ones the iOS app publishes: pages v2 (`extraPages`, service guides on) and NO `source: 'web-app'`.
// tests/render/iosUnchanged.test.ts renders them and compares with tests/render/fixtures/ios-unchanged.json, which was produced
// by the code of origin/main 08186dc (before the Phase 1 service-page work). Never regenerate that fixture from this branch.
import type { WebsiteData } from '../../../types';

const svc = (title: string, extra: Record<string, unknown> = {}) => ({ title, subtitle: '', description: '', icon: 'scissors' as const, imageUrl: '', ...extra });
const base = {
  area: 'Brooklyn, NY', phone: '(512) 555-0100', bookingUrl: '/book', template: 'luxe' as const,
  about: { heading: 'About', description: ['We cut hair.'], imageUrl: '' }, gallery: [] as string[],
  pages: { order: [] as string[], hidden: [] as string[] },
};
const hours = [{ day: 'Mon', open: '09:00', close: '17:00' }, { day: 'Tue', open: '09:00', close: '17:00' }, { day: 'Sun', open: '', close: '', closed: true }];

export const IOS_SITES: Record<string, WebsiteData> = {
  rich: {
    ...base, shopName: 'Fresh Cuts', hero: { heading: 'Fresh Cuts', tagline: 'Sharp cuts', imageUrl: '' },
    services: [
      svc('Skin Fade', { price: '$35', duration: '45 min' }), svc('Low Fade', { price: '$30', duration: '40 min' }), svc('Mid Fade', { price: 'Call for price' }),
      svc('Taper', { price: '$30' }), svc('Beard Trim', { price: '$15', duration: 'Varies' }), svc('Kids Cut', { price: '$20' }), svc('Hot Towel Shave', { price: '$30' }),
      svc('Facial'), svc('Braids', { price: 'From $60' }), svc('Wash & Style', { description: 'Quick wash.' }),
    ],
    hours, contact: { address: '1 Main St, Brooklyn, NY 11201', email: '' },
    extraPages: { on: ['faq', 'first-visit', 'hair-care', 'beard-care'], serviceGuides: true, seed: 5, pick: { 'guide.fade.what': 1 } },
    copy: { 'guide.fade.what': 'Our own words about fades.' },
  } as WebsiteData,
  sparse: {
    ...base, shopName: 'Joe', hero: { heading: 'Joe', tagline: '', imageUrl: '' }, phone: '', bookingUrl: '',
    services: [svc('Haircut'), svc('Facial')], hours: [], contact: { address: 'Mobile - I come to you', email: '' },
    extraPages: { on: [], serviceGuides: false, seed: 2 },
  } as WebsiteData,
  guidesOnNoText: {
    ...base, shopName: 'Cut Co', hero: { heading: 'Cut Co', tagline: '', imageUrl: '' },
    services: [svc('Fade'), svc('Fade + Beard'), svc('The Works'), svc('MVP Cut'), svc("Kids' Cut"), svc('Line-Up')],
    hours, contact: { address: '9 Oak Road', email: '' },
    extraPages: { on: ['faq'], serviceGuides: true, seed: 9 },
  } as WebsiteData,
};
