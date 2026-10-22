// "Honest generated sites" (spec 2026-10-22): a generated site states a fact
// about the shop only if it came from the barber (typed / ticked, their
// booking page, or their confirmed Google listing). Everything else is
// wording true of any barbershop. One test group per audit inventory item.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateHTMLWithPlaceholders } from '../../lib/render/luxe';
import { generatePrimeHTMLWithPlaceholders, DEFAULT_POLICY } from '../../lib/render/prime';
import { generateEuphoriaHTMLWithPlaceholders } from '../../lib/render/euphoria';
import { generateContent } from '../../services/geminiService';
import { buildSiteFromScrape } from '../../lib/buildSiteFromScrape';
import { BOOKSY_NICHES, DEFAULT_BOOKSY_NICHE } from '../../lib/booksyNiche';
import { STOCK_IMAGE_URLS, isStockImage, SERVICE_CHOICES, checklistToServices } from '../../lib/stockImages';
import { reviewsSourceLabel } from '../../lib/render/honest';
import type { WebsiteData } from '../../types';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8');

const YEAR = 2031;
beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(`${YEAR}-06-01T12:00:00Z`)); });
afterAll(() => { vi.useRealTimers(); });

// Bare site: nothing but what a barber typed. No services, cards, email,
// hours, reviews or gallery.
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

// A site saved before this change: invented menu, cards, email, policy.
const legacy = (extra: Partial<WebsiteData> = {}): WebsiteData => bare({
  services: [
    { title: 'Classic Haircut', subtitle: 'Cut, washed, styled', description: 'A clean, considered cut.', icon: 'scissors', imageUrl: '' },
    { title: 'Beard Trim & Styling', subtitle: 'Shaped and finished', description: 'Defined lines.', icon: 'mustache', imageUrl: '' },
  ],
  featureCards: [
    { title: 'Experience', sub: 'Professional' },
    { title: 'Service', sub: 'Trusted' },
    { title: 'Open Monday to Friday', sub: '9am - 7pm' },
  ],
  contact: { address: 'Austin, TX', email: 'contact@freshcuts.com' },
  policy: {
    title: 'Before you arrive',
    body: 'We work appointment-only — your booked time is held for you. Cancellations within 4 hours of the appointment, and no-shows, are billed in full. Please come freshly washed; products and a hot-towel finish are included in every cut.',
  },
  ...extra,
});

const renderers: Record<string, (d: WebsiteData) => string> = {
  luxe: generateHTMLWithPlaceholders,
  prime: generatePrimeHTMLWithPlaceholders,
  euphoria: generateEuphoriaHTMLWithPlaceholders,
};

// Words the rule bans from anything we write on the barber's behalf.
const PUFFERY = /\b(premium|expert|luxury|luxe experience|verified|elite|masters?|renowned|refined|quiet luxury|precision cuts?|precise cuts?|excellence)\b/i;

describe.each(Object.keys(renderers))('%s renderer — honest defaults', (name) => {
  const render = renderers[name];

  it('renders a bare site (no services, cards, email, hours, reviews, gallery)', () => {
    const html = render(bare());
    expect(html).toContain('Fresh Cuts');
    expect(html).not.toMatch(/undefined|NaN/);
  });

  it('hides the Services section and every link to it when there are no services', () => {
    const html = render(bare());
    expect(html).not.toContain('id="services"');
    expect(html).not.toContain('href="#services"');
    expect(html).not.toMatch(/What We Offer|Considered grooming|repertoire/i);
  });

  it('shows the Services section when the barber ticked services', () => {
    const html = render(bare({ services: [{ title: 'Skin fade', subtitle: '', description: '', icon: 'scissors', imageUrl: '', price: '$35' }] }));
    expect(html).toContain('id="services"');
    expect(html).toContain('Skin fade');
    expect(html).toContain('$35');
  });

  it('never says "verified", invents hours, or uses puffery in meta / footer', () => {
    const html = render(bare());
    expect(html).not.toMatch(/verified/i);
    expect(html).not.toMatch(/Monday to Friday|9am - 7pm/i);
    expect(html).not.toMatch(PUFFERY);
  });

  it('writes neutral, niche-aware meta', () => {
    const html = render(bare());
    expect(html).toContain('<title>Fresh Cuts in Austin, TX</title>');
    expect(html).toContain('content="Fresh Cuts — Barbershop in Austin, TX.');
    const nails = render(bare({ niche: 'nails' }));
    expect(nails).toContain('Fresh Cuts — Nail Salon in Austin, TX.');
    expect(nails).not.toMatch(/<title>[^<]*barbershop|name="description" content="[^"]*barbershop/i);
  });

  it('says "Book online." in meta only when there is a booking link', () => {
    expect(render(bare())).not.toContain('Book online.');
    expect(render(bare({ bookingUrl: 'https://booksy.com/x' }))).toContain('Book online.');
  });

  it('omits " in <area>" when the area is empty', () => {
    const html = render(bare({ area: '', contact: { address: '', email: '' } }));
    expect(html).toContain('<title>Fresh Cuts</title>');
    expect(html).not.toMatch(/ in <\/|in \.|in  /);
  });

  it('prints the current year in the copyright, never a hard-coded one', () => {
    const html = render(bare());
    expect(html).toContain(String(YEAR));
    expect(html).not.toContain('2025');
  });

  it('never presents photos as "our work" and uses neutral alt text', () => {
    const html = render(bare({
      about: { heading: 'About', description: ['x'], imageUrl: 'https://example.com/a.jpg' },
      gallery: ['https://example.com/0.jpg', 'https://example.com/1.jpg', 'https://example.com/2.jpg', 'https://example.com/3.jpg'],
    }));
    expect(html).not.toMatch(/our work/i);
    expect(html).not.toMatch(/Atmosphere/);
    expect(html).toMatch(/alt="Fresh Cuts photo"/);
    expect(html).toMatch(/The look/i);
  });

  it('still renders a legacy site (invented menu / cards / email / policy) without errors', () => {
    const html = render(legacy());
    expect(html).toContain('Classic Haircut');
    expect(html).not.toMatch(/Monday to Friday/);
    // the invented contact@<shop>.com address is never shown
    expect(html).not.toContain('contact@freshcuts.com');
    // the invented Prime policy is never shown
    expect(html).not.toMatch(/billed in full/);
  });

  it('shows a typed / scraped email', () => {
    const html = render(bare({ contact: { address: 'Austin, TX', email: 'owner@freshcuts.net' } }));
    if (name === 'euphoria') expect(html).toContain('owner@freshcuts.net');
    else expect(html).not.toContain('contact@');
  });
});

describe('reviews — source labels, no "verified", no invented stars', () => {
  const withReviews = (extra: Partial<WebsiteData> = {}) => bare({
    reviews: [
      { author: 'Ann', rating: 5, comment: 'Great fade, will be back.' },
      { author: 'Bo', comment: 'Quick and friendly, thanks.' },
    ],
    aggregateRating: { rating: 4.8, count: 120 },
    ...extra,
  });

  it('labels the real source', () => {
    expect(reviewsSourceLabel(withReviews({ reviewsSource: 'Google', reviewsSelected: true }))).toBe('Selected reviews from Google');
    expect(reviewsSourceLabel(withReviews({ reviewsSource: 'Booksy' }))).toBe('Reviews from Booksy');
    expect(reviewsSourceLabel(withReviews({ reviewsSource: 'theCut' }))).toBe('Reviews from theCut');
    // legacy booksy site: platform inferred from the booking link
    expect(reviewsSourceLabel(withReviews({ bookingUrl: 'https://booksy.com/en-us/1_x' }))).toBe('Reviews from Booksy');
    expect(reviewsSourceLabel(withReviews())).toBe('Reviews');
  });

  for (const name of ['luxe', 'prime'] as const) {
    it(`${name}: shows the source label and never "verified" / "pulled directly"`, () => {
      const html = renderers[name](withReviews({ reviewsSource: 'Google', reviewsSelected: true }));
      expect(html).toContain('Selected reviews from Google');
      expect(html).not.toMatch(/verified/i);
      expect(html).not.toMatch(/Pulled directly/i);
      const booksy = renderers[name](withReviews({ reviewsSource: 'Booksy' }));
      expect(booksy).toContain('Reviews from Booksy');
      expect(booksy).not.toContain('Selected reviews');
    });

    it(`${name}: a review with no readable rating shows no stars (not 5)`, () => {
      const html = renderers[name](bare({ reviews: [{ author: 'Bo', comment: 'Quick and friendly, thanks.' }] }));
      expect(html).toContain('Quick and friendly');
      expect(html).not.toContain('★');
    });

    it(`${name}: a 3-star review shows 3 lit stars`, () => {
      const html = renderers[name](bare({ reviews: [{ author: 'Cy', rating: 3, comment: 'It was fine overall.' }] }));
      expect(html).toContain('★');
      expect(html).not.toContain('★★★★');
    });

    it(`${name}: aggregate rating only when scraped`, () => {
      const html = renderers[name](bare({ reviews: [{ author: 'Ann', rating: 5, comment: 'Great fade, will be back.' }] }));
      expect(html).not.toMatch(/\d\.\d\s*stars|from \d+ reviews|· \d+ reviews/);
      const agg = renderers[name](withReviews());
      expect(agg).toContain('4.8');
    });
  }
});

describe('prime — policy, walk-ins, stock-photo line', () => {
  it('has no default policy', () => {
    expect(DEFAULT_POLICY.body).toBe('');
    const html = generatePrimeHTMLWithPlaceholders(bare({ services: [{ title: 'Haircut', subtitle: '', description: '', icon: 'scissors', imageUrl: '' }] }));
    expect(html).not.toMatch(/Please Note|Before you arrive|billed in full|appointment-only/i);
  });

  it('renders a barber-written policy, even with no services', () => {
    const html = generatePrimeHTMLWithPlaceholders(bare({ policy: { title: 'Heads up', body: 'Cash only on Sundays.' } }));
    expect(html).toContain('Heads up');
    expect(html).toContain('Cash only on Sundays.');
  });

  it('has no walk-in line unless the barber wrote one', () => {
    expect(generatePrimeHTMLWithPlaceholders(bare())).not.toMatch(/walk-ins?/i);
    const html = generatePrimeHTMLWithPlaceholders(bare({ labels: { bookingNote: 'Walk-ins welcome on Saturdays.' } }));
    expect(html).toContain('Walk-ins welcome on Saturdays.');
  });

  it('says "no stock photos" only when the gallery has photos and none is stock', () => {
    const line = /no stock photos/i;
    expect(generatePrimeHTMLWithPlaceholders(bare())).not.toMatch(line);
    expect(generatePrimeHTMLWithPlaceholders(bare({ gallery: [STOCK_IMAGE_URLS[0], 'https://example.com/mine.jpg'] }))).not.toMatch(line);
    expect(generatePrimeHTMLWithPlaceholders(bare({ gallery: ['https://example.com/mine.jpg'] }))).toMatch(line);
  });

  it('never shows "0 Reviews" when the source gave a rating but no count', () => {
    const html = generatePrimeHTMLWithPlaceholders(bare({
      aggregateRating: { rating: 4.8, count: 0 },
      reviews: [{ author: 'Ann', rating: 5, comment: 'Great fade, will be back.' }],
    }));
    expect(html).toContain('4.8');
    expect(html).not.toMatch(/>0<|\b0 reviews|· 0\b/i);
  });

  it('does not promise instant confirmation', () => {
    const html = generatePrimeHTMLWithPlaceholders(bare({ bookingUrl: 'https://booksy.com/x' }));
    expect(html).not.toMatch(/confirmed instantly/i);
  });
});

describe('stock images + service choices', () => {
  it('lists every default image generateContent uses', async () => {
    for (const template of ['luxe', 'euphoria'] as const) {
      const site = await generateContent({ shopName: 'Fresh Cuts', area: 'Austin, TX', phone: '1', template });
      const used = [site.hero.imageUrl, site.about.imageUrl, ...site.gallery, ...(site.craftImages || [])].filter(Boolean);
      expect(used.length).toBeGreaterThan(0);
      for (const u of used) expect(isStockImage(u)).toBe(true);
    }
  });

  it('matches regardless of query string but not by host alone', () => {
    const u = STOCK_IMAGE_URLS.find((s) => s.includes('unsplash'))!;
    expect(isStockImage(u.split('?')[0] + '?w=10')).toBe(true);
    expect(isStockImage('https://cop5lgctumpj5e0w.public.blob.vercel-storage.com/barber/my-own-upload.jpg')).toBe(false);
    expect(isStockImage('data:image/jpeg;base64,abc')).toBe(false);
    expect(isStockImage('')).toBe(false);
    expect(isStockImage(undefined)).toBe(false);
  });

  it('exports the checklist titles verbatim', () => {
    expect(SERVICE_CHOICES).toEqual(['Haircut', 'Skin fade', 'Taper', 'Beard trim', 'Line up', 'Hot towel shave', 'Kids cut', 'Haircut & beard', 'Hair design', 'Color']);
  });
});

describe('generateContent — typed sites', () => {
  it('invents no services, cards or email', async () => {
    const site = await generateContent({ shopName: 'Fresh Cuts', area: 'Austin, TX', phone: '1' });
    expect(site.services).toEqual([]);
    expect(site.featureCards).toBeUndefined();
    expect(site.contact.email).toBe('');
    expect(site.policy).toBeUndefined();
  });

  it('uses the ticked services verbatim, with optional prices and no invented descriptions', async () => {
    const site = await generateContent({
      shopName: 'Fresh Cuts', area: 'Austin, TX', phone: '1',
      services: [{ title: 'Skin fade', price: '$35' }, { title: 'Beard trim' }, { title: '  ' }],
    });
    expect(site.services.map((s) => s.title)).toEqual(['Skin fade', 'Beard trim']);
    expect(site.services[0].price).toBe('$35');
    expect(site.services[1].price || '').toBe('');
    for (const s of site.services) { expect(s.description).toBe(''); expect(s.subtitle).toBe(''); }
  });

  it('keeps old callers working (no services arg) and writes no puffery or process promises', async () => {
    for (const template of ['luxe', 'euphoria', 'prime'] as const) {
      const site = await generateContent({ shopName: 'Fresh Cuts', area: 'Austin, TX', phone: '1', template });
      const copy = [site.hero.tagline, site.about.heading, ...site.about.description].join(' ');
      expect(copy).not.toMatch(PUFFERY);
      expect(copy).not.toMatch(/every visit|every appointment|honest work|consistent craft|real conversation|confidence|hand-cut|head by head|considered/i);
    }
  });
});

describe('web manual form — services checklist', () => {
  it('checklistToServices keeps checklist order, drops unticked rows, trims prices', () => {
    expect(checklistToServices({})).toEqual([]);
    expect(checklistToServices({
      'Beard trim': { on: true, price: '' },
      Haircut: { on: true, price: ' $30 ' },
      Taper: { on: false, price: '$25' },
      'Not a choice': { on: true },
    })).toEqual([{ title: 'Haircut', price: '$30' }, { title: 'Beard trim' }]);
  });

  it('ticked services reach the typed site; none ticked → no Services section', async () => {
    const withPicks = await generateContent({
      shopName: 'Fresh Cuts', area: 'Austin, TX', phone: '1',
      services: checklistToServices({ 'Skin fade': { on: true, price: '$35' } }),
    });
    const html = generateHTMLWithPlaceholders(withPicks);
    expect(html).toContain('id="services"');
    expect(html).toContain('Skin fade');
    expect(html).toContain('$35');
    const none = await generateContent({ shopName: 'Fresh Cuts', area: 'Austin, TX', phone: '1', services: checklistToServices({}) });
    expect(generateHTMLWithPlaceholders(none)).not.toContain('id="services"');
  });

  it('GeneratorForm shows the checklist on its typed forms and passes the picks to onGenerate', () => {
    const src = read('components/GeneratorForm.tsx');
    expect((src.match(/<ServiceChecklist /g) || []).length).toBe(2);
    expect((src.match(/services: checklistToServices\(servicePicks\)/g) || []).length).toBe(2);
    const list = read('components/ServiceChecklist.tsx');
    expect(list).toContain('Add your services (optional)');
    expect(list).toContain('<details');
    expect(list).toContain('SERVICE_CHOICES');
    expect(list).toContain('Price (optional)');
  });
});

describe('/generate overlay and barbershop funnel — services checklist', () => {
  it('/generate: the phone step shows the collapsed checklist and hands the ticks to onFinish → generateContent', () => {
    const prompts = read('components/GenerateCustomizePrompts.tsx');
    expect(prompts).toContain('<ServiceChecklist value={servicePicks} onChange={setServicePicks} collapsible />');
    expect(prompts).toContain('onFinish(name.trim(), area.trim(), phone.trim(), checklistToServices(servicePicks))');
    const page = read('components/GeneratePage.tsx');
    expect(page).toMatch(/handleFinish = useCallback\(async \(name: string, area: string, phone: string, services[^)]*\)/);
    expect(page).toMatch(/const inputs: ShopInputs = \{[^}]*services \}/);
  });

  it('funnel: the name step shows the collapsed checklist and generateContent gets the ticks (link fallback too)', () => {
    const src = read('components/GenerateBarbershopFunnel.tsx');
    expect(src).toContain('<ServiceChecklist value={servicePicks} onChange={setServicePicks} collapsible />');
    expect(src).toContain("services: checklistToServices(servicePicksRef.current)");
  });

  it('AdminGenerator is left as is', () => {
    expect(read('components/AdminGenerator.tsx')).not.toContain('ServiceChecklist');
  });
});

describe('buildSiteFromScrape — scraped facts only', () => {
  const scrape = (extra: any = {}) => ({
    shopName: 'Fresh Cuts', area: 'Austin, TX', phone: '1',
    services: [
      { title: 'Haircut', price: '$30', duration: '30 min' },
      { title: 'Beard', description: 'Shape-up with razor.' },
    ],
    reviews: [{ author: 'Ann', rating: 5, comment: 'Great fade, will be back.' }],
    photos: [],
    ...extra,
  });

  it('adds no feature cards and no filler descriptions', () => {
    const { scraped } = buildSiteFromScrape(scrape({ _platform: 'booksy' }), 'https://booksy.com/en-us/1_fresh-cuts_barber-shop_1_austin');
    expect(scraped.featureCards).toBeUndefined();
    expect(scraped.services[0].description).toBe('');
    expect(scraped.services[0].price).toBe('$30');
    expect(scraped.services[1].description).toBe('Shape-up with razor.');
    const all = JSON.stringify(scraped);
    expect(all).not.toMatch(/Book ahead|Starting at|same care every visit/);
  });

  it('records the review source; Google reviews are marked as selected', () => {
    const booksy = buildSiteFromScrape(scrape({ _platform: 'booksy' }), 'https://booksy.com/en-us/1_x_barber-shop_1_y').scraped;
    expect(booksy.reviewsSource).toBe('Booksy');
    expect(booksy.reviewsSelected).toBeFalsy();
    const gbp = buildSiteFromScrape(scrape({ _platform: 'gbp', services: [] }), '').scraped;
    expect(gbp.reviewsSource).toBe('Google');
    expect(gbp.reviewsSelected).toBe(true);
  });

  it('a Google barber who ticks only "Haircut" stays a barbershop', () => {
    const { scraped } = buildSiteFromScrape(scrape({ _platform: 'gbp', _categories: ['Barber shop'], services: [{ title: 'Haircut' }] }), '');
    expect(scraped.niche).toBe('barber');
  });

  it('stores the niche so renderers can label the business', () => {
    const { scraped } = buildSiteFromScrape(scrape({ shopName: 'Polished', services: [{ title: 'Gel manicure' }] }), 'https://booksy.com/en-us/1_polished_nail-salon_1_austin');
    expect(scraped.niche).toBe('nails');
    expect(generateHTMLWithPlaceholders(scraped)).toContain('Nail Salon');
  });

  it('writes a generic about fallback with no process promises', () => {
    const { scraped } = buildSiteFromScrape(scrape({ description: '' }), '');
    expect(scraped.about.description.join(' ')).toContain('Fresh Cuts is a barbershop in Austin, TX.');
  });
});

describe('niche fallbacks — generic welcomes only', () => {
  const PROMISES = /\b(every|always|careful|unhurried|steady|honest|consistent|clean(ly)?|quickly|comfortabl[ey]|low-stress|root|cause|consult(ation)?|assessment|quoted|surprises|on time|properly|reliable|relax|patience|lasts?|plainly|listening|budget|premium|expert|luxury|tailored|custom|answers the phone|doing right|fixed routine|real bodywork|not a script|photograph well|your pace|steady progress|protective styles)\b/i;
  for (const n of [DEFAULT_BOOKSY_NICHE, ...BOOKSY_NICHES]) {
    it(`${n.key}: no process promises`, () => {
      for (const s of [n.heroTagline, n.aboutHeading, ...n.aboutFallback]) expect(s).not.toMatch(PROMISES);
    });
  }
});

describe('React previews and vendored sources carry none of the removed copy', () => {
  const FILES = [
    'components/GeneratedWebsite.tsx', 'components/PrimeWebsite.tsx', 'components/EuphoriaWebsite.tsx',
    'components/GbpImportPage.tsx',
    'lib/render/luxe.ts', 'lib/render/prime.ts', 'lib/render/euphoria.ts',
    'services/geminiService.ts', 'lib/buildSiteFromScrape.ts', 'lib/booksyNiche.ts',
  ];
  const BANNED = [
    'Our Work', 'Our work, on the chair', 'Barber Shop Atmosphere', 'verified reviews', 'Pulled directly from the booking page',
    'Open Monday to Friday', "'Experience', sub: 'Professional'", 'Premium Barbershop', 'Expert barbers, luxury experience',
    'Premium Grooming Excellence', 'Precision cuts, classic grooming', 'Quiet luxury', '© 2025', 'Copyright &copy; 2025',
    'Book ahead — same care every visit', 'Starting at $', 'Starting at ${', 'contact@${', 'confirmed instantly',
    'walk-ins welcomed when chairs allow', 'billed in full', 'DEFAULT_BARBER_SERVICES', 'Considered grooming', 'repertoire',
    'Hand-cut, head by head', 'Hand-cut,',
  ];
  for (const f of FILES) {
    it(f, () => {
      const src = read(f);
      for (const b of BANNED) expect(src, `${f} contains "${b}"`).not.toContain(b);
    });
  }

  it('GbpImportPage asks "Is this you?" and shows the services checklist before building', () => {
    const src = read('components/GbpImportPage.tsx');
    for (const s of ['Is this you?', 'Yes, that&rsquo;s me', 'Not my business', 'SERVICE_CHOICES', 'Price (optional)']) {
      expect(src, s).toContain(s);
    }
    // the Google branch parks the payload instead of building straight away
    expect(src).toMatch(/endpoint === '\/api\/import-business'[\s\S]{0,200}setPending\(\{ payload, step: 'confirm' \}\)/);
  });

  it('React Prime gates the "no stock photos" line on isStockImage', () => {
    const src = read('components/PrimeWebsite.tsx');
    expect(src).toContain('isStockImage');
  });

  it('vendored shared modules import nothing outside the vendored set', () => {
    const VENDORED = [
      'types.ts', 'services/geminiService.ts', 'lib/render/luxe.ts', 'lib/render/prime.ts', 'lib/render/euphoria.ts',
      'lib/render/safeHref.ts', 'lib/render/honest.ts', 'lib/buildSiteFromScrape.ts', 'lib/booksyNiche.ts',
      'lib/brandSwatches.ts', 'lib/supportedBookingHost.ts', 'lib/stockImages.ts',
    ];
    const norm = (p: string) => p.replace(/\.(ts|js)$/, '');
    const set = new Set(VENDORED.map(norm));
    for (const f of VENDORED) {
      const src = read(f);
      for (const m of src.matchAll(/from\s+['"]([^'"]+)['"]/g)) {
        const spec = m[1];
        expect(spec.startsWith('.'), `${f} imports package ${spec}`).toBe(true);
        const resolved = norm(join(f, '..', spec));
        expect(set.has(resolved), `${f} imports ${spec} (outside the vendored set)`).toBe(true);
      }
    }
  });
});

describe('api/gemini is dead code and unreachable', () => {
  it('answers 410 without calling Gemini', async () => {
    const { default: handler } = await import('../../api/gemini');
    const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    await handler({ method: 'POST', body: { shopName: 'x' } }, res);
    expect(res.status).toHaveBeenCalledWith(410);
  });
});
