import { describe, expect, it } from 'vitest';
import { LABELS, LABEL_KEYS, defaultLabel, navLabelKey, PAGE_TITLE_KEY, plainLabel, t, visibleLabelKeys, visiblePageLabelKeys, type LabelKey } from '../../lib/render/labels';
import { PAGE_KEYS } from '../../lib/render/pages';
import { nicheByKey } from '../../lib/booksyNiche';
import type { WebsiteData } from '../../types';

const site = (extra: Partial<WebsiteData> = {}): WebsiteData => ({
  shopName: 'Fresh Cuts', area: 'Austin, TX', phone: '(512) 555-0100', template: 'luxe',
  hero: { heading: 'h', tagline: 't', imageUrl: '' },
  about: { heading: 'About', description: ['We have cut hair since 1998.'], imageUrl: '' },
  services: [{ title: 'Fade', subtitle: '', description: 'd', icon: 'scissors', imageUrl: '', price: '$30' }],
  gallery: [], contact: { address: '1 Main St', email: '' }, bookingUrl: '/book', shopUrl: '/shop',
  hours: [{ day: 'Mon', open: '9', close: '5', closed: false }, { day: 'Sun', open: '', close: '', closed: true }],
  ...extra,
});

describe('multi-page labels', () => {
  it('the single-page tappable list never includes a multi-page label', () => {
    for (const template of ['luxe', 'prime', 'euphoria'] as const) {
      for (const k of visibleLabelKeys(site({ template }))) expect((LABELS[k] as { multi?: unknown }).multi, k).toBeUndefined();
    }
  });
  it('every page has a title label, a menu label and a default within the cap', () => {
    for (const key of PAGE_KEYS) for (const template of ['luxe', 'prime', 'euphoria'] as const) {
      const k = navLabelKey(template, key);
      expect(LABEL_KEYS).toContain(k);
    }
    for (const k of Object.values(PAGE_TITLE_KEY) as LabelKey[]) {
      expect(Array.from(defaultLabel(k, nicheByKey('barber'))).length).toBeLessThanOrEqual(LABELS[k].max);
    }
  });
  it('luxe keeps the menu keys barbers already saved; prime and euphoria keep their Shop keys', () => {
    expect(navLabelKey('luxe', 'home')).toBe('navHome');
    expect(navLabelKey('luxe', 'services')).toBe('navServices');
    expect(navLabelKey('luxe', 'contact')).toBe('navContact');
    expect(navLabelKey('luxe', 'shop')).toBe('navShop');
    expect(navLabelKey('prime', 'shop')).toBe('primeNavShop');
    expect(navLabelKey('euphoria', 'shop')).toBe('euNavShop');
    expect(navLabelKey('prime', 'about')).toBe('pgNavAbout');
  });
  it('the team page title follows the niche', () => {
    expect(defaultLabel('pgTeamTitle', nicheByKey('barber'))).toBe('Meet Our Barbers');
    expect(defaultLabel('pgTeamTitle', nicheByKey('nails'))).toBe('Meet the Team');
  });
  it('visiblePageLabelKeys: the menu entries that are on, plus that page\'s own labels', () => {
    const d = site({ pages: { order: [], hidden: ['hours'] } });
    const about = visiblePageLabelKeys(d, 'about');
    expect(about).toContain('pgAboutTitle');
    expect(about).toContain('navHome');
    expect(about).toContain('navServices');
    expect(about).toContain('pgNavAbout');
    expect(about).not.toContain('pgNavHours'); // hidden page: not in the menu
    expect(about).not.toContain('pgServicesTitle'); // another page's title
    expect(about).toContain('footerLine');
    expect(visiblePageLabelKeys(d, 'contact')).toEqual(expect.arrayContaining(['pgContactTitle', 'pgAddressLabel', 'pgPhoneLabel', 'pgBookCta', 'pgShopCta']));
    expect(visiblePageLabelKeys(d, 'contact')).not.toContain('pgEmailLabel'); // no email
  });
  it('prime has no footer-line label; home adds the single-page section labels', () => {
    expect(visiblePageLabelKeys(site({ template: 'prime' }), 'about')).not.toContain('footerLine');
    expect(visiblePageLabelKeys(site(), 'home')).toContain('contactHeading');
  });
  it('a site with only Home has no menu labels', () => {
    const d = site({ about: { heading: 'x', description: [], imageUrl: '' }, services: [], phone: '', contact: { address: '', email: '' }, bookingUrl: '', shopUrl: '', hours: [] });
    expect(visiblePageLabelKeys(d, 'about')).not.toContain('navHome');
  });
  it('t() escapes the new labels; plainLabel returns the raw text without markers', () => {
    expect(t({ pgAboutTitle: '<b>x</b>' }, 'pgAboutTitle')).toBe('&lt;b&gt;x&lt;/b&gt;');
    expect(plainLabel({ pgAboutTitle: '⁣ab⁣Our story⁣/⁣' }, 'pgAboutTitle')).toBe('Our story');
    expect(plainLabel({}, 'pgAboutTitle')).toBe('About us');
  });
  it('the Reviews page title and menu label cannot carry a typed rating or count (P3b review S1)', () => {
    const typed = site({ labels: { pgReviewsTitle: '5.0 stars from 999 reviews', pgNavReviews: '999 reviews' } });
    expect(t(typed.labels, 'pgReviewsTitle', nicheByKey('barber'), typed)).toBe('What clients say');
    expect(t(typed.labels, 'pgNavReviews', nicheByKey('barber'), typed)).toBe('Reviews');
    expect(plainLabel(typed.labels, 'pgReviewsTitle', nicheByKey('barber'), typed)).toBe('What clients say');
    const words = site({ labels: { pgReviewsTitle: 'Kind words', pgNavReviews: 'Praise' } });
    expect(t(words.labels, 'pgReviewsTitle', nicheByKey('barber'), words)).toBe('Kind words');
    expect(t(words.labels, 'pgNavReviews', nicheByKey('barber'), words)).toBe('Praise');
  });
});
