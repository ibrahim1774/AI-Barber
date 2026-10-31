import { describe, expect, it } from 'vitest';
import { extractFirstUrl, isSupportedBookingHost } from '../../lib/supportedBookingHost';
import { photosAreFromBookingPage, platformLabel, reviewsSourceName } from '../../lib/render/honest';
import { buildSiteFromScrape } from '../../lib/buildSiteFromScrape';
import { detectPlatform } from '../../lib/scrapers/index';

describe('isSupportedBookingHost', () => {
  it.each([
    'https://getsquire.com/booking/book/x', 'getsquire.com/discover/barbershop/x', 'https://drthebarber.glossgenius.com',
    'https://app.acuityscheduling.com/schedule.php?owner=1', 'leobarbershop.as.me', 'https://booksy.com/x', 'https://www.vagaro.com/x',
  ])('accepts %s', (u) => expect(isSupportedBookingHost(u)).toBe(true));
  it.each(['https://calendly.com/x', 'https://example.com', 'https://notas.me.evil.com', ''])('rejects %s', (u) => expect(isSupportedBookingHost(u)).toBe(false));
  it('every host the browser list accepts is also an adapter host (and the reverse), so the two never drift', () => {
    const hosts = ['getsquire.com', 'x.glossgenius.com', 'app.acuityscheduling.com', 'x.as.me', 'booksy.com', 'thecut.co', 'fresha.com', 'styleseat.com', 'squareup.com', 'x.square.site', 'vagaro.com', 'heygoldie.com', 'setmore.com', 'calendly.com', 'example.com'];
    for (const h of hosts) expect(isSupportedBookingHost(`https://${h}/x`)).toBe(!!detectPlatform(`https://${h}/x`).adapter);
  });
  it('a share sentence with a new provider link is found', () => {
    expect(extractFirstUrl('Book me: drthebarber.glossgenius.com thanks')).toBe('https://drthebarber.glossgenius.com');
    expect(extractFirstUrl('see leobarbershop.as.me/schedule')).toBe('https://leobarbershop.as.me/schedule');
  });
});

describe('imported photos stay the barber\'s own listing photos', () => {
  it.each([['squire', 'Squire'], ['glossgenius', 'GlossGenius'], ['acuity', 'Acuity']])('%s label', (id, label) => expect(platformLabel(id)).toBe(label));
  it('booking links on the new hosts count as booking-page photos and name the review source', () => {
    for (const u of ['https://getsquire.com/booking/book/x', 'https://x.glossgenius.com', 'https://x.as.me', 'https://app.acuityscheduling.com/x']) {
      expect(photosAreFromBookingPage({ bookingUrl: u })).toBe(true);
      expect(reviewsSourceName({ bookingUrl: u })).not.toBe('');
    }
  });
  it('scraped photos fill hero, about and the gallery in order; no stock photo is added when there are none', () => {
    const photos = Array.from({ length: 10 }, (_, i) => `https://cdn.test/${i}.jpg`);
    const withPhotos = buildSiteFromScrape({ shopName: 'A', photos, _platform: 'glossgenius' }, 'https://a.glossgenius.com').scraped;
    expect(withPhotos.hero.imageUrl).toBe(photos[0]);
    expect(withPhotos.about.imageUrl).toBe(photos[1]);
    expect(withPhotos.gallery).toEqual(photos.slice(0, 8));
    expect(withPhotos.importedFrom).toBe('booking');
    const none = buildSiteFromScrape({ shopName: 'A', photos: [], _platform: 'acuity' }, 'https://a.as.me').scraped;
    expect(none.hero.imageUrl).toBe('');
    expect(none.gallery.every((g) => g === '')).toBe(true);
  });
});
