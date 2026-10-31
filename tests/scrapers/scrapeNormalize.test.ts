import { describe, expect, it } from 'vitest';
import { normalizeDuration, normalizeHours, normalizePrice, priceFromBounds, toHHMM } from '../../lib/scrapeNormalize';
import { finalize, ldToScrapedShop } from '../../lib/scrapers/util';
import { buildSiteFromScrape } from '../../lib/buildSiteFromScrape';

describe('normalizePrice', () => {
  it.each([
    ['30', '$30'], ['30.00', '$30'], ['30.5', '$30.50'], ['$30', '$30'], ['$30.00', '$30'], ['$$30', '$30'],
    ['$30+', '$30'.concat('+')], ['30+', '$30+'], ['from $30', 'from $30'], ['From $25.00', 'From $25'],
    ['$25 - $40', '$25 - $40'], ['25-40', '$25 - $40'], ['$25–$40', '$25–$40'], ['£20', '£20'], ['  $35   ', '$35'],
    ['$35$30', '$30'], ['Free', 'Free'], ['free', 'Free'],
  ])('%s -> %s', (raw, want) => expect(normalizePrice(raw)).toBe(want));
  it('numbers, and no price at all', () => {
    expect(normalizePrice(30)).toBe('$30');
    expect(normalizePrice(32.5, '£')).toBe('£32.50');
    for (const raw of [0, '0', '', '  ', 'Varies', 'Price varies', 'N/A', undefined, null, NaN]) expect(normalizePrice(raw)).toBe('');
  });
  it('is idempotent', () => {
    for (const raw of ['30', '$25 - $40', '$30+', 'from $30', 'Free', '$35$30']) {
      const once = normalizePrice(raw);
      expect(normalizePrice(once)).toBe(once);
    }
  });
  it('low and high bounds', () => {
    expect(priceFromBounds('25', '40')).toBe('$25 - $40');
    expect(priceFromBounds(25, 25)).toBe('$25');
    expect(priceFromBounds('30', undefined)).toBe('$30');
    expect(priceFromBounds(undefined, undefined)).toBe('');
  });
});

describe('normalizeDuration', () => {
  it.each([
    ['30min', '30 min'], ['30 mins', '30 min'], ['30 minutes', '30 min'], ['45', '45 min'], [45, '45 min'], ['1h', '1 hr'],
    ['1 hr 15 min', '1 hr 15 min'], ['1h15m', '1 hr 15 min'], ['90 min', '1 hr 30 min'], ['PT1H15M', '1 hr 15 min'], ['PT30M', '30 min'],
    ['30-45 min', '30-45 min'], ['', ''], ['soon', 'soon'],
  ])('%s -> %s', (raw, want) => expect(normalizeDuration(raw)).toBe(want));
});

describe('normalizeHours', () => {
  it('reads 12-hour and 24-hour clock text to HH:MM, with the narrow no-break space Google prints', () => {
    expect(toHHMM('9:00 AM')).toBe('09:00');
    expect(toHHMM('7 PM')).toBe('19:00');
    expect(toHHMM('12 AM')).toBe('00:00');
    expect(toHHMM('12:30 pm')).toBe('12:30');
    expect(toHHMM('9am')).toBe('09:00');
    expect(toHHMM('17:00')).toBe('17:00');
    expect(toHHMM('8:00')).toBe('08:00');
    expect(toHHMM('By appointment')).toBe('By appointment');
  });
  it('rows keep their order; a day without times is closed', () => {
    const out = normalizeHours([
      { day: 'Monday', open: '7 AM', close: '7 PM' },
      { day: 'Tuesday', open: '', close: '' },
      { day: 'Wednesday', open: '09:00', close: '17:00', closed: true },
    ]);
    expect(out).toEqual([
      { day: 'Monday', open: '07:00', close: '19:00' },
      { day: 'Tuesday', open: '', close: '', closed: true },
      { day: 'Wednesday', open: '09:00', close: '17:00', closed: true },
    ]);
  });
  it('nothing usable, or every day closed, is no hours (the app then starts from Mon-Sat 9-5)', () => {
    expect(normalizeHours(undefined)).toEqual([]);
    expect(normalizeHours([])).toEqual([]);
    expect(normalizeHours([{ day: 'Monday', open: '', close: '', closed: true }])).toEqual([]);
  });
  it('is idempotent', () => {
    const once = normalizeHours([{ day: 'Monday', open: '9:00 AM', close: '5:30 PM' }]);
    expect(normalizeHours(once)).toEqual(once);
  });
});

describe('prices through the JSON-LD mapping (Booksy / Fresha)', () => {
  const ld = (offers: any[]) => ({ '@type': 'HealthAndBeautyBusiness', name: 'ASR Cuts', hasOfferCatalog: { itemListElement: offers } });
  const price = (offer: any) => ldToScrapedShop(ld([offer])).services![0].price;
  it('reads every place a price can be', () => {
    expect(price({ itemOffered: { name: 'Fade' }, price: '35' })).toBe('$35');
    expect(price({ itemOffered: { name: 'Fade' }, price: 35, priceCurrency: 'USD' })).toBe('$35');
    expect(price({ itemOffered: { name: 'Fade' }, price: '$35.00' })).toBe('$35');
    expect(price({ itemOffered: { name: 'Fade' }, priceSpecification: { price: '35.50' } })).toBe('$35.50');
    expect(price({ itemOffered: { name: 'Fade', offers: { price: '35' } } })).toBe('$35');
    expect(price({ itemOffered: { name: 'Fade', offers: [{ price: '35' }] } })).toBe('$35');
    expect(price({ itemOffered: { name: 'Fade' }, priceSpecification: { minPrice: '25', maxPrice: '40' } })).toBe('$25 - $40');
    expect(price({ itemOffered: { name: 'Fade', offers: { '@type': 'AggregateOffer', lowPrice: '25', highPrice: '40' } } })).toBe('$25 - $40');
    expect(price({ itemOffered: { name: 'Fade' }, price: '30', priceCurrency: 'GBP' })).toBe('£30');
  });
  it('a service with no price keeps no price', () => {
    expect(price({ itemOffered: { name: 'Fade' } })).toBe('');
    expect(price({ itemOffered: { name: 'Fade' }, price: 'Varies' })).toBe('');
  });
  it('durations read the ISO form', () => {
    expect(ldToScrapedShop(ld([{ itemOffered: { name: 'Fade', estimatedDuration: 'PT45M' }, price: 30 }])).services![0].duration).toBe('45 min');
  });
});

describe('finalize cleans what Apify / any adapter returned', () => {
  it('prices, durations and hours land in one shape', () => {
    const shop = finalize({
      shopName: 'ASR Cuts', area: '', address: '', photos: [], reviews: [],
      services: [
        { title: 'Skin fade', price: '$35.00', duration: '45min' },
        { title: 'Lineup', price: 'Varies', duration: '' },
        { title: 'Kids', price: '25+' },
      ],
      hours: [{ day: 'Monday', open: '9:00 AM', close: '6:00 PM' }, { day: 'Tuesday', open: '', close: '', closed: true }],
    });
    expect(shop.services.map((s) => [s.price, s.duration])).toEqual([['$35', '45 min'], [undefined, undefined], ['$25+', undefined]]);
    expect(shop.hours).toEqual([{ day: 'Monday', open: '09:00', close: '18:00' }, { day: 'Tuesday', open: '', close: '', closed: true }]);
  });
});

describe('buildSiteFromScrape keeps every scraped price, duration and hour', () => {
  const payload = {
    shopName: 'ASR Cuts', _platform: 'booksy',
    services: [
      { title: 'Skin fade', price: '35', duration: '45min', category: 'Haircuts' },
      { title: 'Beard', price: '$20 - $30', duration: '', category: 'Beards' },
      { title: 'Lineup', price: '', duration: '' },
    ],
    hours: [{ day: 'Monday', open: '8 AM', close: '5 PM' }],
  };
  it('maps them into the service rows and the hours.<i> rows', () => {
    const { scraped } = buildSiteFromScrape(payload, 'https://booksy.com/x');
    expect(scraped.services!.map((s) => [s.price, s.duration, s.subtitle])).toEqual([
      ['$35', '45 min', '45 min'], ['$20 - $30', '', 'Beards'], ['', '', ''],
    ]);
    expect(scraped.hours).toEqual([{ day: 'Monday', open: '08:00', close: '17:00' }]);
  });
  it('a Google import keeps the typed prices exactly', () => {
    const { scraped } = buildSiteFromScrape({ ...payload, _platform: 'gbp', services: [{ title: 'Cut', price: 'ask us' }] }, '');
    expect(scraped.services![0].price).toBe('ask us');
  });
});
