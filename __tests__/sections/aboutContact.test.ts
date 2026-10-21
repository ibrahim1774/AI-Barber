import type { WebsiteData } from '@/web/types';
import { aboutError, aboutFields, contactError, contactFields, setAbout, setContact } from '@/lib/sections/aboutContact';

const site = (): WebsiteData => ({
  shopName: 'Fresh Cuts',
  area: 'Austin',
  phone: '555-0100',
  hero: { heading: 'H', tagline: 'Sharp fades', imageUrl: '' },
  about: { heading: 'About', description: ['First paragraph.', 'Second paragraph.'], imageUrl: '' },
  services: [],
  gallery: [],
  contact: { address: '1 Main St', email: 'a@b.com' },
});

describe('about', () => {
  it('round-trips', () => {
    const d = site();
    expect(setAbout(d, aboutFields(d))).toEqual(d);
    expect(aboutFields(d).about).toBe('First paragraph.\n\nSecond paragraph.');
  });
  it('rejects an empty shop name', () => {
    const d = site();
    const f = { ...aboutFields(d), shopName: '  ' };
    expect(aboutError(f)).toBeTruthy();
    expect(setAbout(d, f)).toBe(d);
  });
  it('cleans text and splits on blank lines', () => {
    const out = setAbout(site(), { shopName: '<Fresh>', tagline: 'a<b>', about: 'One <x>\nstill one\n\n\n  Two  ' });
    expect(out.shopName).toBe('Fresh');
    expect(out.hero.tagline).toBe('ab');
    expect(out.about.description).toEqual(['One x\nstill one', 'Two']);
  });
  it('allows an empty about', () => {
    expect(setAbout(site(), { shopName: 'S', tagline: '', about: '' }).about.description).toEqual([]);
  });
});

describe('contact', () => {
  it('round-trips', () => {
    const d = site();
    expect(setContact(d, contactFields(d))).toEqual(d);
  });
  it('rejects an invalid email', () => {
    const d = site();
    const f = { ...contactFields(d), email: 'nope' };
    expect(contactError(f)).toBeTruthy();
    expect(setContact(d, f)).toBe(d);
  });
  it('an empty email clears the field', () => {
    const out = setContact(site(), { phone: '1', address: 'x', email: '' });
    expect(out.contact.email).toBe('');
    expect(contactError({ phone: '', address: '', email: '' })).toBeNull();
  });
  it('cleans text', () => {
    const out = setContact(site(), { phone: ' 555 ', address: '<1> Main', email: ' a@b.co ' });
    expect(out.phone).toBe('555');
    expect(out.contact).toEqual({ address: '1 Main', email: 'a@b.co' });
  });
});
