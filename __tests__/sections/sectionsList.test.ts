import type { WebsiteData } from '@/web/types';
import { sectionCards } from '@/lib/sections/list';

const d = (o: Partial<WebsiteData> = {}): WebsiteData => ({
  shopName: 'Fresh Cuts', area: '', phone: '555-1234', hero: { heading: '', tagline: '', imageUrl: '' },
  about: { heading: '', description: [], imageUrl: '' }, services: [], gallery: [], ...o,
} as unknown as WebsiteData);
const sum = (x: WebsiteData) => Object.fromEntries(sectionCards(x).map((c) => [c.key, c.summary]));

describe('sectionCards', () => {
  it('orders the six cards', () => {
    expect(sectionCards(d()).map((c) => c.title)).toEqual(['Services', 'Team', 'Hours', 'Gallery', 'About', 'Contact']);
  });
  it('summarises empty', () => {
    expect(sum(d())).toEqual({
      services: 'None yet', team: 'Not set', hours: 'Not set', gallery: '0 of 6 photos', about: 'Fresh Cuts', contact: '555-1234',
    });
    expect(sum(d({ phone: '' })).contact).toBe('Not set');
  });
  it('counts', () => {
    const s: any = { title: 'a' };
    const hours = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, i) => ({ day, open: '09:00', close: '17:00', closed: i > 4 }));
    const x = sum(d({
      services: [s], staff: [{ name: 'a' }, { name: 'b' }], hours,
      gallery: ['a', 'b', 'c', '', 'e', 'f', 'g', 'h'],
    }));
    expect(x.services).toBe('1 service');
    expect(x.team).toBe('2 people');
    expect(x.hours).toBe('Open 5 days');
    expect(x.gallery).toBe('5 of 6 photos'); // indices 2-7: c,'',e,f,g,h
    expect(sum(d({ services: [s, s, s] })).services).toBe('3 services');
  });
  it('uses indices 0-5 for Design 2', () => {
    expect(sum(d({ template: 'prime', gallery: ['a', 'b', '', '', '', '', 'x', 'y'] })).gallery).toBe('2 of 6 photos');
  });
});
