import { describe, expect, it } from 'vitest';
import { logoDataUrlOf, MAX_LOGO_BYTES } from '../../lib/scrapers/logoDataUrl';
import { validateWebSnapshot } from '../../lib/webApp/publishFlow';
import { ScrapeError } from '../../lib/scrapers/types';

const img = (contentType: string, n = 10) => async () => ({ buffer: Buffer.alloc(n, 1), contentType, finalUrl: 'https://x.example/l.png' });

describe('logoDataUrlOf', () => {
  it('returns a data URL for png, jpeg, webp', async () => {
    for (const t of ['image/png', 'image/jpeg', 'image/webp']) expect(await logoDataUrlOf('https://x.example/l', img(t))).toMatch(new RegExp(`^data:${t};base64,`));
  });
  it('drops gif, avif, oversize, empty and failures', async () => {
    expect(await logoDataUrlOf('https://x.example/l', img('image/gif'))).toBeUndefined();
    expect(await logoDataUrlOf('https://x.example/l', img('image/avif'))).toBeUndefined();
    expect(await logoDataUrlOf('https://x.example/l', img('image/png', MAX_LOGO_BYTES + 1))).toBeUndefined();
    expect(await logoDataUrlOf('https://x.example/l', img('image/png', 0))).toBeUndefined();
    expect(await logoDataUrlOf('https://x.example/l', async () => { throw new ScrapeError('no', 'blocked_url'); })).toBeUndefined();
    expect(await logoDataUrlOf(undefined)).toBeUndefined();
  });
});

describe('a website import publishes', () => {
  const site: any = {
    bio: 'A one-barber shop in Albany.', area: 'Albany, GA', niche: 'barber', template: 'luxe', source: 'web-app', importedFrom: 'website',
    shopName: 'Cutz', phone: '(229) 449-6675', bookingUrl: '/book', colorTheme: '#f4a100',
    hero: { heading: 'Cutz', tagline: 'Book your next visit.', imageUrl: 'https://d2zdpiztbgorvt.cloudfront.net/a.jpeg' },
    about: { heading: 'About', imageUrl: 'https://d2zdpiztbgorvt.cloudfront.net/b.jpeg', description: ['x'] },
    hours: [{ day: 'Monday', open: '16:00', close: '20:00' }], pages: { order: [], hidden: [] }, staff: [], reviews: [],
    contact: { email: '', address: '2601 Dawson Rd, Albany, GA, 31707' },
    gallery: ['a', 'b', 'c'].map((n) => `https://d2zdpiztbgorvt.cloudfront.net/${n}.jpeg`),
    services: [{ icon: 'scissors', price: '$35', title: 'Cut', category: '', duration: '30 min', imageUrl: '', subtitle: '30 min', description: '' }],
    extraPages: { on: ['faq'], seed: 1, serviceGuides: true },
  };
  it('accepts importedFrom website, third-party https photos, no logo, bookingUrl /book', () => {
    expect(() => validateWebSnapshot(site)).not.toThrow();
  });
  it('still refuses an external logo URL (regression for the invalid_draft bug)', () => {
    expect(() => validateWebSnapshot({ ...site, logo: { url: 'https://cutz-by-ant.vercel.app/images/logo.png', w: 400, h: 100 } })).toThrow('invalid_snapshot');
  });
});
