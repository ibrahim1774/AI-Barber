import { describe, it, expect } from 'vitest';
import { telHref } from '../../lib/render/telHref.js';
import { renderSite } from '../../lib/render/site.js';
import { generatePrimeHTMLWithPlaceholders } from '../../lib/render/prime.js';

describe('telHref', () => {
  it.each([
    ['5125550199', 'tel:+15125550199'],
    ['(512) 555-0199', 'tel:+15125550199'],
    ['512.555.0199', 'tel:+15125550199'],
    ['1 512 555 0199', 'tel:+15125550199'],
    ['1-512-555-0199', 'tel:+15125550199'],
    ['+1 (512) 555-0199', 'tel:+15125550199'],
    ['+44 20 7946 0958', 'tel:+442079460958'],
    ['0044 20 7946 0958', 'tel:+442079460958'],
    ['+52 55 1234 5678', 'tel:+525512345678'],
    ['5551234', 'tel:5551234'],
    ['  +1 512 555 0199  ', 'tel:+15125550199'],
  ])('%j -> %s', (p, href) => { expect(telHref(p)).toBe(href); });
  it.each(['', '   ', 'call us', '12345', '+12', '1234567890123456', null, undefined, 5])('%j has no link', (p) => { expect(telHref(p)).toBe(''); });
});

describe('prime Book/Call button with no booking link', () => {
  const base = { shopName: 'Fresh Cuts', area: 'Austin, TX', template: 'prime', bookingUrl: '', hero: { heading: 'x', tagline: 'y', imageUrl: '' }, about: { heading: 'About', description: ['Hi.'], imageUrl: '' }, services: [], gallery: [], reviews: [], hours: [], contact: { address: '', email: '' }, pages: { order: [], hidden: [] } } as any;
  it.each([['+1 (512) 555-0199', 'tel:+15125550199'], ['+44 20 7946 0958', 'tel:+442079460958'], ['(512) 555-0199', 'tel:+15125550199']])('%s', (phone, href) => {
    const site = renderSite({ ...base, phone }, 'prime').map((f) => f.html).join('');
    const home = generatePrimeHTMLWithPlaceholders({ ...base, phone });
    for (const out of [site, home]) {
      expect(out).toContain(`href="${href}"`);
      expect(out).not.toMatch(/tel:\+1(1|44)/);
    }
  });
});
