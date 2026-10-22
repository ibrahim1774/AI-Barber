// Honest sites — review fix round 1 (server-review.md findings 1-10).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateHTMLWithPlaceholders } from '../../lib/render/luxe';
import { generatePrimeHTMLWithPlaceholders } from '../../lib/render/prime';
import { generateEuphoriaHTMLWithPlaceholders } from '../../lib/render/euphoria';
import { buildSiteFromScrape } from '../../lib/buildSiteFromScrape';
import { checklistToServices } from '../../lib/stockImages';
import { displayPrice, reviewsSourceLabel, withoutLegacyCopy } from '../../lib/render/honest';
import type { WebsiteData } from '../../types';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2031-06-01T12:00:00Z')); });
afterAll(() => { vi.useRealTimers(); });

const renderers: Record<string, (d: WebsiteData) => string> = {
  luxe: generateHTMLWithPlaceholders,
  prime: generatePrimeHTMLWithPlaceholders,
  euphoria: generateEuphoriaHTMLWithPlaceholders,
};

const bare = (extra: Partial<WebsiteData> = {}): WebsiteData => ({
  shopName: 'Fresh Cuts',
  area: 'Austin, TX',
  phone: '(512) 555-0100',
  hero: { heading: 'Fresh Cuts', tagline: 'Book your next visit.', imageUrl: '' },
  about: { heading: 'About', description: ['Fresh Cuts is a barbershop in Austin, TX.'], imageUrl: '' },
  services: [],
  gallery: [],
  contact: { address: 'Austin, TX', email: '' },
  ...extra,
});

const svc = (extra: Partial<WebsiteData['services'][number]> = {}): WebsiteData['services'][number] => ({
  title: 'Haircut', subtitle: '', description: '', icon: 'scissors', imageUrl: '', ...extra,
});

// ── Finding 1 / 10: escaping ─────────────────────────────────────────
describe.each(Object.keys(renderers))('%s escapes every barber / scraped field', (name) => {
  const render = renderers[name];
  const BAD = '<b>x</b>&<img src=y onerror=alert(1)>';

  it('services: title, price, duration/subtitle, description', () => {
    const html = render(bare({
      services: [
        svc({ title: `T${BAD}`, price: `P${BAD}`, duration: `D${BAD}`, description: `X${BAD}` }),
        svc({ title: 'Shave', subtitle: `S${BAD}` }),
      ],
    }));
    expect(html).not.toContain('<b>x</b>');
    expect(html).not.toContain('<img src=y');
    expect(html).toContain('&lt;b&gt;x&lt;/b&gt;&amp;&lt;img src=y onerror=alert(1)&gt;');
  });

  it('identity, copy, labels, reviews, staff, hours, source line', () => {
    const html = render(bare({
      shopName: `Shop${BAD}`,
      area: `Area${BAD}`,
      phone: `555${BAD}`,
      hero: { heading: `H${BAD}`, tagline: `T${BAD}`, imageUrl: '' },
      about: { heading: `A${BAD}`, description: [`D${BAD}`], imageUrl: '' },
      contact: { address: `Addr${BAD}`, email: '' },
      labels: { servicesHeading: `L${BAD}`, teamHeading: `L${BAD}`, contactHeading: `L${BAD}`, bookingNote: `N${BAD}` },
      reviews: [{ author: `Au${BAD}`, rating: 5, comment: `C${BAD}`, date: `Dt${BAD}` }],
      reviewsSource: `Src${BAD}`,
      staff: [{ name: `St${BAD}`, role: `R${BAD}` }],
      hours: [{ day: `Mon${BAD}`, open: `9${BAD}`, close: '17' }],
      bio: `Bio long enough to render ${BAD}`,
      policy: { title: `Pt${BAD}`, body: `Pb${BAD}` },
      services: [svc()],
    }));
    expect(html).not.toContain('<b>x</b>');
    expect(html).not.toContain('<img src=y');
    expect(html).not.toMatch(/onerror=alert\(1\)>/);
  });
});

// ── Finding 2: price once ────────────────────────────────────────────
describe('a service price shows exactly once', () => {
  const count = (html: string, s: string) => html.split(s).length - 1;

  it('Google import with a ticked price', () => {
    const { scraped } = buildSiteFromScrape({
      shopName: 'Fresh Cuts', area: 'Austin, TX', phone: '1', photos: [], reviews: [],
      services: checklistToServices({ Haircut: { on: true, price: '$31' } }),
      _platform: 'gbp', _categories: ['Barber shop'],
    } as any, '');
    expect(scraped.services[0].subtitle).toBe('');
    for (const [n, render] of Object.entries(renderers)) expect(count(render(scraped), '$31'), n).toBe(1);
  });

  it('Booksy service with a price and no duration', () => {
    const { scraped } = buildSiteFromScrape({
      shopName: 'Fresh Cuts', services: [{ title: 'Kids Cut', price: '$22' }], photos: [], reviews: [], _platform: 'booksy',
    } as any, 'https://booksy.com/en-us/1_fresh-cuts_barber-shop_1_austin');
    for (const [n, render] of Object.entries(renderers)) expect(count(render(scraped), '$22'), n).toBe(1);
  });

  it('old stored site whose subtitle carries the price', () => {
    const site = bare({ services: [svc({ title: 'Fade', price: '$33', duration: '', subtitle: '30 min · $33' }), svc({ title: 'Kids', price: '$23', subtitle: '$23' })] });
    for (const [n, render] of Object.entries(renderers)) {
      const html = render(site);
      expect(count(html, '$33'), n).toBe(1);
      expect(count(html, '$23'), n).toBe(1);
      expect(html, n).toContain('30 min');
    }
  });
});

// ── Finding 3: legacy invented content on old stored sites ───────────
describe('old stored sites drop the known invented content (exact match only)', () => {
  const LUXE_DEFAULTS = [
    ['Classic Haircut', 'Cut, washed, styled', 'A clean, considered cut tailored to how you actually wear your hair.', 'scissors'],
    ['Beard Trim & Styling', 'Shaped and finished', 'Defined lines, blended length, and a finish that holds between visits.', 'mustache'],
    ['Hot Towel Shave', 'Straight razor, classic finish', 'A traditional straight-razor shave with warm towels and a clean, close finish.', 'razor'],
    ['Skin Fade', 'Sharp, blended, exact', 'Precise tapering from skin upward, blended for a clean, modern shape.', 'face'],
    ['Hair & Scalp Treatment', 'Cleanse and condition', 'A thorough cleanse and conditioning treatment to reset the scalp.', 'sparkles'],
  ] as const;
  const EUPHORIA_DEFAULTS = [
    ['Classic Haircut', 'A clean, considered cut shaped around how you actually wear your hair.'],
    ['Beard Trim & Styling', 'Defined edges and blended length — a finish that reads on and off the chair.'],
    ['Hot Towel Shave', 'Warm towels and a straight razor, finished close and clean.'],
    ['Skin Fade', 'Precise skin-up tapering blended into a clean, modern shape.'],
    ['Hair & Scalp Treatment', 'A deep cleanse and conditioning treatment to reset the scalp between cuts.'],
  ] as const;

  const oldTyped = (extra: Partial<WebsiteData> = {}): WebsiteData => bare({
    hero: { heading: 'Kings Cuts', tagline: 'Premium grooming, considered every step.', imageUrl: '' },
    about: {
      heading: 'Built around the cut.',
      description: ['Kings Cuts is a neighborhood barbershop in Austin, TX built around honest work and consistent craft. Every visit starts with a real conversation and ends with a cut you can wear with confidence.'],
      imageUrl: '',
    },
    shopName: 'Kings Cuts',
    services: LUXE_DEFAULTS.map(([title, subtitle, description, icon]) => svc({ title, subtitle, description, icon: icon as any })),
    reviews: [{ author: 'Ann', rating: 5, comment: 'Great fade, will be back.' }],
    ...extra,
  });

  it('drops the exact default 5-service set (luxe / Google default and euphoria)', () => {
    expect(withoutLegacyCopy(oldTyped()).services).toEqual([]);
    const eu = oldTyped({ services: EUPHORIA_DEFAULTS.map(([title, description]) => svc({ title, description })) });
    expect(withoutLegacyCopy(eu).services).toEqual([]);
    for (const [n, render] of Object.entries(renderers)) {
      const html = render(oldTyped());
      expect(html, n).not.toContain('Classic Haircut');
      expect(html, n).not.toContain('id="services"');
    }
  });

  it('keeps the list when the barber changed any of it', () => {
    const edited = oldTyped();
    edited.services[0] = { ...edited.services[0], description: 'My own words.' };
    expect(withoutLegacyCopy(edited).services).toHaveLength(5);
    const trimmed = oldTyped();
    trimmed.services = trimmed.services.slice(0, 4);
    expect(withoutLegacyCopy(trimmed).services).toHaveLength(4);
    const plus = oldTyped();
    plus.services = [...plus.services, svc({ title: 'Kids cut' })];
    expect(withoutLegacyCopy(plus).services).toHaveLength(6);
  });

  it('replaces the "Premium…" / old niche taglines and the templated about text and heading', () => {
    const v = withoutLegacyCopy(oldTyped());
    expect(v.hero.tagline).toBe('Book your next visit.');
    expect(v.about.heading).toBe('About the Shop');
    expect(v.about.description).toEqual(['Kings Cuts is a barbershop in Austin, TX.', 'Get in touch to book your next appointment.']);
    const eu = withoutLegacyCopy(oldTyped({
      hero: { heading: 'K', tagline: 'Hand-cut, head by head.', imageUrl: '' },
      about: { heading: 'Craft, character, and community.', description: ['Kings Cuts is a barbershop in Austin, TX built around the cut you want — sharp, considered, and made for the people we serve. Every appointment is real conversation followed by real craft.'], imageUrl: '' },
    }));
    expect(eu.hero.tagline).toBe('Book your next visit.');
    expect(eu.about.heading).toBe('About the Shop');
    expect(eu.about.description[0]).toBe('Kings Cuts is a barbershop in Austin, TX.');
    const booksy = withoutLegacyCopy(oldTyped({
      hero: { heading: 'K', tagline: 'Premium grooming services tailored to your style.', imageUrl: '' },
      about: { heading: 'About the Shop', description: ['Kings Cuts is a neighborhood barbershop built around honest work and consistent craft.', 'Every visit starts with a real conversation and ends with a cut you can wear with confidence.'], imageUrl: '' },
    }));
    expect(booksy.hero.tagline).toBe('Book your next visit.');
    expect(booksy.about.description[0]).toBe('Kings Cuts is a barbershop in Austin, TX.');
    const nails = withoutLegacyCopy(bare({ niche: 'nails', hero: { heading: 'P', tagline: 'Nail care that lasts, in a space you can relax in.', imageUrl: '' } }));
    expect(nails.hero.tagline).toBe('Book your next appointment.');
  });

  it('leaves the barber’s own copy alone', () => {
    const own = bare({ hero: { heading: 'K', tagline: 'Premium grooming, considered every step!', imageUrl: '' }, about: { heading: 'Our story', description: ['We opened in 2019.'], imageUrl: '' } });
    expect(withoutLegacyCopy(own)).toEqual(own);
  });

  it('strips the "Book ahead…" and "Starting at $X." fillers, keeping the service and price', () => {
    const v = withoutLegacyCopy(bare({ services: [
      svc({ title: 'Fade', description: 'Book ahead — same care every visit.' }),
      svc({ title: 'Kids', price: '$20', description: 'Starting at $20.' }),
      svc({ title: 'Shave', price: '$25', description: 'Starting at $30.' }),
    ] }));
    expect(v.services.map((s) => s.description)).toEqual(['', '', 'Starting at $30.']);
    expect(v.services[1].price).toBe('$20');
    const html = generateHTMLWithPlaceholders(bare({ services: [svc({ title: 'Kids', price: '$20', description: 'Starting at $20.' })] }));
    expect(html).not.toContain('Starting at');
    expect(html).toContain('$20');
  });

  it('stored 5★ ratings stay', () => {
    const html = generateHTMLWithPlaceholders(oldTyped());
    expect(html).toContain('★');
    expect(withoutLegacyCopy(oldTyped()).reviews![0].rating).toBe(5);
  });

  it('every renderer drops the legacy copy from an old stored site', () => {
    for (const [n, render] of Object.entries(renderers)) {
      const html = render(oldTyped());
      expect(html, n).not.toMatch(/Premium grooming|Built around the cut|honest work|real conversation/);
    }
  });

  it('the React editors read the cleaned view', () => {
    for (const f of ['components/GeneratedWebsite.tsx', 'components/PrimeWebsite.tsx', 'components/EuphoriaWebsite.tsx']) {
      expect(read(f), f).toContain('withoutLegacyCopy(siteData)');
    }
  });
});

// ── Finding 4: editor can add / remove / edit services ───────────────
describe('web editors manage services (source checks: node env cannot render React)', () => {
  for (const f of ['components/GeneratedWebsite.tsx', 'components/PrimeWebsite.tsx', 'components/EuphoriaWebsite.tsx']) {
    it(f, () => {
      const src = read(f);
      expect(src).toContain('<AddServiceRow');
      expect(src).toMatch(/removeService\(/);
      expect(src).toContain("'Add price'");
      expect(src).toContain("'Add description'");
    });
  }
  it('AddServiceRow builds a service from typed fields only', () => {
    const src = read('components/AddServiceRow.tsx');
    expect(src).toContain('Price (optional)');
    expect(src).toContain('Description (optional)');
  });
});

// ── Finding 5: empty rows hidden ─────────────────────────────────────
describe.each(Object.keys(renderers))('%s hides empty phone / location rows', (name) => {
  it('no phone, no address', () => {
    const html = renderers[name](bare({ phone: '', area: '', contact: { address: '', email: '' } }));
    expect(html).not.toMatch(/Call Now:\s*</);
    expect(html).not.toContain('href="tel:"');
    expect(html).not.toContain('href="tel:+1"');
    expect(html).not.toMatch(/>LOCATION</);
    expect(html).not.toMatch(/>PHONE</);
    expect(html).not.toMatch(/By Phone/);
    expect(html).not.toMatch(/>Phone</);
    expect(html).not.toMatch(/>Call\s*</);
  });
});

// ── Finding 6: no lone "Reviews" source line ─────────────────────────
describe('no lone "Reviews" source line when the source is unknown', () => {
  it('label is empty for unknown, unfiltered reviews', () => {
    expect(reviewsSourceLabel(bare())).toBe('');
    expect(reviewsSourceLabel(bare({ reviewsSelected: true }))).toBe('Selected reviews');
  });
  it('luxe / prime render no empty source line', () => {
    for (const n of ['luxe', 'prime']) {
      const html = renderers[n](bare({ reviews: [{ author: 'Ann', rating: 5, comment: 'Great fade, will be back.' }] }));
      expect(html, n).not.toMatch(/data-reviews-source/);
    }
    expect(generatePrimeHTMLWithPlaceholders(bare({ reviewsSource: 'Booksy', reviews: [{ author: 'Ann', rating: 5, comment: 'Great fade.' }] }))).toContain('data-reviews-source');
  });
});

// ── Finding 7: niche-aware body copy ─────────────────────────────────
describe('niche-aware body copy', () => {
  const staff = [{ name: 'Jo', role: 'Artist' }];
  it('luxe team heading', () => {
    expect(generateHTMLWithPlaceholders(bare({ staff }))).toContain('Meet Our Barbers');
    const nails = generateHTMLWithPlaceholders(bare({ staff, niche: 'nails' }));
    expect(nails).toContain('Meet the Team');
    expect(nails).not.toContain('Meet Our Barbers');
  });
  it('prime booking strip and pull quote', () => {
    expect(generatePrimeHTMLWithPlaceholders(bare())).toContain('your next cut?');
    const lash = generatePrimeHTMLWithPlaceholders(bare({ niche: 'lashes' }));
    expect(lash).not.toMatch(/\bcut\b|chair/i);
    expect(lash).toContain('your next visit?');
    // a barber-written pull quote always wins
    expect(generatePrimeHTMLWithPlaceholders(bare({ niche: 'lashes', pullQuote: { text: 'Lashes by Jo.' } }))).toContain('Lashes by Jo.');
  });
  it('the misleading "categories first" comment is gone', () => {
    expect(read('lib/buildSiteFromScrape.ts')).not.toContain('Google categories first');
  });
});

// ── Finding 8: stock-photo line only for booking-page photos ─────────
describe('prime "no stock photos" line', () => {
  const own = ['https://example.com/a.jpg'];
  it('shows for booking-page photos', () => {
    expect(generatePrimeHTMLWithPlaceholders(bare({ gallery: own, importedFrom: 'booking' }))).toMatch(/no stock photos/);
    // older Booksy site: inferred from the booking link
    expect(generatePrimeHTMLWithPlaceholders(bare({ gallery: own, bookingUrl: 'https://booksy.com/en-us/1_x' }))).toMatch(/no stock photos/);
  });
  it('never for Google imports or typed sites', () => {
    expect(generatePrimeHTMLWithPlaceholders(bare({ gallery: own, importedFrom: 'gbp', reviewsSource: 'Google' }))).not.toMatch(/no stock photos/);
    expect(generatePrimeHTMLWithPlaceholders(bare({ gallery: own }))).not.toMatch(/no stock photos/);
  });
  it('buildSiteFromScrape records where the site came from', () => {
    expect(buildSiteFromScrape({ shopName: 'X', _platform: 'gbp' } as any, '').scraped.importedFrom).toBe('gbp');
    expect(buildSiteFromScrape({ shopName: 'X', _platform: 'booksy' } as any, 'https://booksy.com/x').scraped.importedFrom).toBe('booking');
  });
});

// ── Finding 9: bare numeric prices get "$" ───────────────────────────
describe('prices', () => {
  it('displayPrice adds "$" to a bare number only', () => {
    expect(displayPrice('25')).toBe('$25');
    expect(displayPrice(' 25.50 ')).toBe('$25.50');
    expect(displayPrice('$25')).toBe('$25');
    expect(displayPrice('25+')).toBe('25+');
    expect(displayPrice('£20')).toBe('£20');
    expect(displayPrice('')).toBe('');
    expect(displayPrice(undefined)).toBe('');
  });
  it('checklist prices are normalised and every template shows "$25"', () => {
    expect(checklistToServices({ Haircut: { on: true, price: '25' } })).toEqual([{ title: 'Haircut', price: '$25' }]);
    for (const [n, render] of Object.entries(renderers)) {
      expect(render(bare({ services: [svc({ price: '25' })] })), n).toContain('$25');
    }
  });
  it('price inputs accept "$" (no decimal-only keyboard)', () => {
    for (const f of ['components/ServiceChecklist.tsx', 'components/GbpImportPage.tsx', 'components/AddServiceRow.tsx']) {
      expect(read(f), f).not.toContain('inputMode="decimal"');
    }
  });
});
