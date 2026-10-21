import type { ServiceItem } from '@/web/types';
import type { Service } from '@/lib/shop';
import { centsToPrice, parsePriceCents, servicesToWebsite, websiteToSetupServices } from '@/lib/setup/servicesMap';

const item = (o: Partial<ServiceItem>): ServiceItem => ({ title: 'Haircut', subtitle: '', description: '', icon: 'scissors', imageUrl: '', ...o });
const svc = (o: Partial<Service>): Service => ({
  id: 'x', shopId: 's', name: 'Haircut', priceCents: 3000, durationMin: 30, description: '', photoUrl: null,
  bookable: true, showOnSite: true, depositType: 'none', depositValue: null, sort: 0, ...o,
});

describe('price parsing', () => {
  it.each([['$30', 3000], ['30', 3000], ['$25.50', 2550], ['$25.5', 2550], ['From $25', 2500], ['$1,200', 120000], ['$30+', 3000]])('%s', (s, c) => {
    expect(parsePriceCents(s)).toBe(c);
  });
  it.each([[''], [undefined], ['Free'], ['$30 - $40'], ['Ask']])('%s is null', (s) => {
    expect(parsePriceCents(s as string | undefined)).toBeNull();
  });
  it('formats cents', () => {
    expect(centsToPrice(3000)).toBe('$30');
    expect(centsToPrice(2550)).toBe('$25.50');
    expect(centsToPrice(120000)).toBe('$1,200');
    expect(centsToPrice(5)).toBe('$0.05');
  });
});

describe('websiteToSetupServices', () => {
  it('maps price, duration, description and photo; skips unnamed and data: images', () => {
    const out = websiteToSetupServices([
      item({ title: ' Fade ', price: '$35', duration: '45 min', description: 'Clean', imageUrl: 'https://x/y.jpg' }),
      item({ title: 'Beard', price: 'Ask', duration: '1 hr 30 min', imageUrl: 'data:image/png;base64,AA' }),
      item({ title: '  ' }),
      item({ title: 'Line up' }),
    ]);
    expect(out).toEqual([
      { name: 'Fade', priceCents: 3500, durationMin: 45, description: 'Clean', photoUrl: 'https://x/y.jpg' },
      { name: 'Beard', priceCents: null, durationMin: 90 },
      { name: 'Line up', priceCents: null, durationMin: 30 },
    ]);
  });
});

describe('servicesToWebsite', () => {
  it('mirrors only show_on_site services, in order, as "$30" and "30 min"', () => {
    const out = servicesToWebsite([
      svc({ id: 'b', name: 'Beard', sort: 1, priceCents: 2550, durationMin: 15 }),
      svc({ id: 'h', name: 'Hidden', sort: 2, showOnSite: false }),
      svc({ id: 'a', name: 'Cut', sort: 0, priceCents: null, durationMin: 90, description: 'd', photoUrl: 'https://p' }),
    ]);
    expect(out.map((s) => s.title)).toEqual(['Cut', 'Beard']);
    expect(out[0]).toMatchObject({ duration: '1 hr 30 min', description: 'd', imageUrl: 'https://p' });
    expect(out[0].price).toBeUndefined();
    expect(out[1]).toMatchObject({ price: '$25.50', duration: '15 min' });
  });
  it('keeps icon, subtitle and category of an existing item with the same title', () => {
    const out = servicesToWebsite([svc({ name: 'beard trim' })], [item({ title: 'Beard Trim', icon: 'razor', subtitle: 'sub', category: 'Beards' })]);
    expect(out[0]).toMatchObject({ icon: 'razor', subtitle: 'sub', category: 'Beards' });
  });
  it('round-trips through the setup mapping', () => {
    const web = servicesToWebsite([svc({ priceCents: 4500, durationMin: 45 })]);
    expect(websiteToSetupServices(web)).toEqual([{ name: 'Haircut', priceCents: 4500, durationMin: 45 }]);
  });
});

describe('websiteToSetupServices limits (the server 400s on anything over)', () => {
  it('clamps text, duration and photo, and caps the list', () => {
    const [a] = websiteToSetupServices([
      item({ title: 'x'.repeat(120), description: 'd'.repeat(900), duration: '1 min', imageUrl: 'http://insecure/p.jpg' }),
    ]);
    expect(a.name).toHaveLength(80);
    expect(a.description).toHaveLength(500);
    expect(a.durationMin).toBe(5);
    expect(a.photoUrl).toBeUndefined();
    expect(websiteToSetupServices([item({ duration: '20 hours' })])[0].durationMin).toBe(600);
    expect(websiteToSetupServices([item({ imageUrl: 'https://cdn/p.jpg' })])[0].photoUrl).toBe('https://cdn/p.jpg');
    const many = Array.from({ length: 70 }, (_, i) => item({ title: `S${i}` }));
    expect(websiteToSetupServices(many)).toHaveLength(50);
  });
});
