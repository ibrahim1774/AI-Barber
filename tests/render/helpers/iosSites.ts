// Sites shaped like the ones the iOS app publishes: pages v2 (`extraPages`, service guides on) and NO `source: 'web-app'`.
// tests/render/iosUnchanged.test.ts renders them with the code of origin/main 08186dc (rebuilt from git at test time, helpers/
// iosBaseline.ts) and with this branch, and requires identical output; the stored fixture tests/render/fixtures/ios-unchanged.json
// is the same baseline kept for clones that lack the commit. The fixture is only ever written FROM THE BASELINE (REGEN_IOS_FIXTURE=1).
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

// A wide spread of iOS-shaped sites (hostile titles, free-text values, every address kind, svc.* overrides and picks, the guide
// section hidden, long descriptions, 1 / 3 / 20 services of one kind), the same shapes the Opus differential used.
const long = 'A full haircut with a consultation, a wash, clipper and scissor work, a neck shave and styling to finish the look.';
const TITLES = ['Braids', 'The Works', 'MVP Cut', 'Beard Trim', 'Fade + Beard', "Kids' Cut", 'Line-Up', 'Skin Fade (Mid)', 'SKIN FADE', 'haircut.', 'low fade', 'Fade 🔥 Special!!', `${'A'.repeat(85)} Fade`, 'Low Fade', 'Mid Fade', 'High Fade', 'Taper', 'Hot Towel Shave', 'Highlights', 'Designs'];
const PRICES = ['Call for price', '$25+', '', '$35', 'Free', '30'];
const DURS = ['30-45 min', '', 'Varies', '45 min', '30'];
let n = 0;
for (const guides of [true, false]) for (const addr of ['12 Main St, Austin, TX', '', 'Mobile - I come to you']) for (const count of [1, 3, 20]) {
  const i = n++;
  IOS_SITES[`gen-g${guides ? 1 : 0}-a${addr.length}-n${count}`] = {
    ...base, shopName: i % 2 ? 'Fresh Cuts' : 'Fresh Cuts Fresh Cuts', phone: i % 3 ? '(512) 555-0100' : '', bookingUrl: i % 2 ? '/book' : '',
    hero: { heading: 'Fresh', tagline: '', imageUrl: '' },
    services: TITLES.slice(0, count).map((t, k) => svc(t, { price: PRICES[k % PRICES.length], duration: DURS[k % DURS.length], description: k % 4 === 3 ? long : '' })),
    hours, contact: { address: addr, email: '' },
    extraPages: { on: ['faq', 'first-visit', 'hair-care', 'beard-care'], serviceGuides: guides, seed: i + 1, pick: { 'svc.low fade.visit': 1 } },
    copy: i % 2 ? { 'svc.low fade.visit': 'Owner text.', 'svc.skin fade.alt': 'x' } : {},
    pageSections: i % 4 === 0 ? { service: { hidden: ['guide'] } } : undefined,
  } as unknown as WebsiteData;
}
