import { describe, expect, it } from 'vitest';
import {
  aboutParagraphs, assertSiteFilePath, buildPageSet, canonicalBase, cleanPagesModel, eligiblePages, isGeneratedAbout,
  isReservedPath, MIN_GALLERY_PHOTOS, ownGallerySlots, pageFileFor, pageHref, pageList, pagePath, plainText, RESERVED_PATHS, SERVICE_PAGE_CAP,
  servicePageEligible, sitemapXml, slugify, uniqueSlug,
} from '../../lib/render/pages';
import { LUXE_STOCK, DEMO_GALLERY_STOCK } from '../../lib/stockImages';
import type { WebsiteData } from '../../types';

const base = (extra: Partial<WebsiteData> = {}): WebsiteData => ({
  shopName: 'Fresh Cuts', area: 'Austin, TX', phone: '', template: 'luxe',
  hero: { heading: 'Fresh Cuts', tagline: 'Book your next visit.', imageUrl: '' },
  about: { heading: 'About the Shop', description: ['Fresh Cuts is a barbershop in Austin, TX. Get in touch to book your next appointment.'], imageUrl: '' },
  services: [], gallery: [], contact: { address: '', email: '' },
  ...extra,
});
const svc = (title: string, extra: Record<string, string> = {}) => ({ title, subtitle: '', description: '', icon: 'scissors' as const, imageUrl: '', ...extra });
const MID = '3f2b8c1e-4a5d-4e6f-8a9b-0c1d2e3f4a5b';

describe('eligibility table', () => {
  it('a bare site is Home only', () => {
    expect(eligiblePages(base())).toEqual(['home']);
  });

  describe('About', () => {
    it.each([
      ['geminiService combined paragraph', ['Fresh Cuts is a barbershop in Austin, TX. Get in touch to book your next appointment.']],
      ['geminiService, no area', ['Fresh Cuts is a barbershop. Get in touch to book your next appointment.']],
      ['buildSiteFromScrape with area', ['Fresh Cuts is a barbershop in Austin, TX.', 'Get in touch to book your next appointment.']],
      ['buildSiteFromScrape without area', ['Fresh Cuts is a barbershop.', 'Get in touch to book your next appointment.']],
      ['another niche', ['Glow Nails is a nail salon in Reno, NV.']],
      ['a renamed shop keeps the generated text generated', ['Old Name is a barbershop in Austin, TX.']],
      ['markers around generated text', ['⁣ab⁣Fresh Cuts is a barbershop in Austin, TX.⁣/⁣']],
      ['empty paragraphs', ['', '   ']],
    ])('%s -> no About page', (_n, description) => {
      const d = base({ about: { heading: 'About', description, imageUrl: '' } });
      expect(aboutParagraphs(d)).toEqual([]);
      expect(eligiblePages(d)).not.toContain('about');
    });

    it('the legacy invented text is replaced by the generated sentence -> no About page', () => {
      const d = base({
        about: {
          heading: 'Built around the cut.',
          description: ['Fresh Cuts is a neighborhood barbershop in Austin, TX built around honest work and consistent craft. Every visit starts with a real conversation and ends with a cut you can wear with confidence.'],
          imageUrl: '',
        },
      });
      expect(eligiblePages(d)).not.toContain('about');
    });

    it('a paragraph the barber wrote -> About page, and only that paragraph is the page text', () => {
      const d = base({ about: { heading: 'About', description: ['Fresh Cuts is a barbershop in Austin, TX.', 'We have cut hair on Main Street since 1998.'], imageUrl: '' } });
      expect(eligiblePages(d)).toContain('about');
      expect(aboutParagraphs(d)).toEqual(['We have cut hair on Main Street since 1998.']);
    });

    it('isGeneratedAbout only matches whole generated shapes', () => {
      expect(isGeneratedAbout('We are a barbershop in Austin and we love it.')).toBe(false);
      expect(isGeneratedAbout('Fresh Cuts is a barbershop in Austin, TX.')).toBe(true);
    });

    it('real barber text that merely starts like a generated sentence is kept (P3b review S2)', () => {
      for (const p of [
        "Fresh Cuts is a barbershop in Austin. We've cut hair since 1998.",
        'Our shop is a barbershop in the heart of Austin where every cut is done by hand.',
        'Kings Cuts is a barbershop in Brooklyn serving the community since 2005.',
        'Fresh Cuts is a barbershop in Austin. Get in touch to book your next appointment. We love fades.',
      ]) expect(isGeneratedAbout(p), p).toBe(false);
      expect(aboutParagraphs({ about: { heading: 'About', description: ["Fresh Cuts is a barbershop in Austin. We've cut hair since 1998."], imageUrl: '' } })).toHaveLength(1);
    });

    it('the generated sentences are still recognised, with an abbreviation in the area', () => {
      expect(isGeneratedAbout('Fresh Cuts is a barbershop in St. Louis, MO.')).toBe(true);
      expect(isGeneratedAbout('Fresh Cuts is a barbershop in Austin, TX. Get in touch to book your next appointment.')).toBe(true);
      expect(isGeneratedAbout('Fresh Cuts is a barbershop.')).toBe(true);
      // a long area is still ours when it is the stored one
      const area = 'the Greater Metropolitan Area of Central Texas and Beyond';
      expect(isGeneratedAbout(`Fresh Cuts is a barbershop in ${area}.`, { shopName: 'Fresh Cuts', area })).toBe(true);
      expect(isGeneratedAbout(`Fresh Cuts is a barbershop in ${area}.`)).toBe(false);
    });
  });

  describe('Services and per-service pages', () => {
    it('every titled service gets its own page, even with nothing else set (owner feedback 2026-10-24)', () => {
      const d = base({ services: [svc('Haircut')] });
      const set = buildPageSet(d);
      expect(set.eligible).toContain('services');
      expect(set.services.map((s) => s.slug)).toEqual(['haircut']);
      expect(set.files.map((f) => f.path)).toEqual(['index.html', 'services/index.html', 'services/haircut/index.html']);
    });
    it('no services, or only untitled ones -> no Services page and no service pages', () => {
      expect(buildPageSet(base({ services: [] })).files.map((f) => f.path)).toEqual(['index.html']);
      const set = buildPageSet(base({ services: [svc('  '), svc('')] }));
      expect(set.eligible).not.toContain('services');
      expect(set.services).toEqual([]);
    });
    it(`at most ${SERVICE_PAGE_CAP} service pages: the first ones in order, the rest counted; slugs unchanged by the cap`, () => {
      const services = Array.from({ length: 15 }, (_, i) => svc(`Cut ${i + 1}`));
      const set = buildPageSet(base({ services }));
      expect(set.services).toHaveLength(SERVICE_PAGE_CAP);
      expect(set.services[0].slug).toBe('cut-1');
      expect(set.services[SERVICE_PAGE_CAP - 1].slug).toBe(`cut-${SERVICE_PAGE_CAP}`);
      expect(set.servicesOverCap).toBe(3);
    });
    it('two services with the same name get fade and fade-2; a reserved-looking name stays under services/', () => {
      const set = buildPageSet(base({ services: [svc('Fade'), svc('fade'), svc('Book'), svc('Shop')] }));
      expect(set.services.map((s) => s.slug)).toEqual(['fade', 'fade-2', 'book', 'shop']);
      expect(set.files.map((f) => f.path)).toContain('services/book/index.html');
    });
    it.each([['description', { description: 'A clean cut.' }], ['price', { price: '$30' }], ['duration', { duration: '30 min' }]])(
      'a service with a %s gets its own page', (_n, extra) => {
        const set = buildPageSet(base({ services: [svc('Haircut', extra)] }));
        expect(set.services.map((s) => s.slug)).toEqual(['haircut']);
        expect(set.files.map((f) => f.path)).toContain('services/haircut/index.html');
      },
    );
    it('the default invented menu is not a Services page', () => {
      const legacy = [
        ['Classic Haircut', 'A clean, considered cut tailored to how you actually wear your hair.', 'Cut, washed, styled'],
        ['Beard Trim & Styling', 'Defined lines, blended length, and a finish that holds between visits.', 'Shaped and finished'],
        ['Hot Towel Shave', 'A traditional straight-razor shave with warm towels and a clean, close finish.', 'Straight razor, classic finish'],
        ['Skin Fade', 'Precise tapering from skin upward, blended for a clean, modern shape.', 'Sharp, blended, exact'],
        ['Hair & Scalp Treatment', 'A thorough cleanse and conditioning treatment to reset the scalp.', 'Cleanse and condition'],
      ].map(([title, description, subtitle]) => svc(title, { description, subtitle }));
      expect(eligiblePages(base({ services: legacy }))).not.toContain('services');
    });
    it('filler descriptions from old imports are dropped, but the titled service still has its page', () => {
      const set = buildPageSet(base({ services: [svc('Haircut', { description: 'Book ahead — same care every visit.' })] }));
      expect(set.services.map((s) => s.slug)).toEqual(['haircut']);
    });
    it('servicePageEligible: a title is enough', () => {
      expect(servicePageEligible(svc('x'))).toBe(true);
      expect(servicePageEligible(svc(' '))).toBe(false);
      expect(servicePageEligible(null)).toBe(false);
    });
  });

  describe('Team and per-member pages', () => {
    const only = (m: Record<string, unknown>) => buildPageSet(base({ staff: [{ name: 'Sam Fade', ...m }] as any }));
    it('a role-only member -> Team page, no member page', () => {
      const set = only({ role: 'Owner' });
      expect(set.eligible).toContain('team');
      expect(set.team).toEqual([]);
    });
    it.each([
      ['own bio', { bio: 'Skin fades.' }],
      ['own photo', { photo: 'has-image' }],
      ['an explicit service subset', { serviceIds: ['abc'] }],
      ['hours of their own', { hours: [{ day: 'Mon', open: '10:00', close: '16:00' }] }],
    ])('%s -> member page', (_n, m) => {
      expect(only(m).team.map((t) => t.slug)).toEqual(['sam-fade']);
    });
    it('an empty service list means "all services": no member page', () => {
      expect(only({ serviceIds: [] }).team).toEqual([]);
    });
    it('hours equal to the shop hours are inherited: no member page; different hours count', () => {
      const hours = [{ day: 'Mon', open: '09:00', close: '17:00' }];
      const same = buildPageSet(base({ hours, staff: [{ name: 'Sam', hours: [{ day: 'mon', open: '09:00', close: '17:00' }] }] as any }));
      expect(same.team).toEqual([]);
      const diff = buildPageSet(base({ hours, staff: [{ name: 'Sam', hours: [{ day: 'Mon', open: '10:00', close: '17:00' }] }] as any }));
      expect(diff.team.length).toBe(1);
    });
    it('the slug and index follow the stored staff[] (a nameless entry is skipped, not renumbered)', () => {
      const set = buildPageSet(base({ staff: [{ name: '' }, { name: 'Jay Cut', bio: 'x' }] as any }));
      expect(set.team).toEqual([{ group: 'team', slug: 'jay-cut', index: 1, title: 'Jay Cut' }]);
    });
  });

  describe('Gallery', () => {
    const own = (n: number) => Array.from({ length: n }, (_, i) => `https://img.example.com/own-${i}.jpg`);
    it('needs at least 3 of the barber\'s own photos', () => {
      expect(MIN_GALLERY_PHOTOS).toBe(3);
      expect(eligiblePages(base({ gallery: own(2) }))).not.toContain('gallery');
      expect(eligiblePages(base({ gallery: own(3) }))).toContain('gallery');
    });
    it('stock-only -> no Gallery', () => {
      expect(eligiblePages(base({ gallery: [...DEMO_GALLERY_STOCK] }))).not.toContain('gallery');
      expect(eligiblePages(base({ gallery: [LUXE_STOCK.gallerySeed, LUXE_STOCK.about, LUXE_STOCK.hero] }))).not.toContain('gallery');
    });
    it('stock photos do not count towards the three', () => {
      expect(eligiblePages(base({ gallery: [...own(2), ...DEMO_GALLERY_STOCK] }))).not.toContain('gallery');
      expect(eligiblePages(base({ gallery: [...own(3), ...DEMO_GALLERY_STOCK] }))).toContain('gallery');
    });
    it('in the pending shape the URLs come from imageUrls, not from the slot markers', () => {
      const slots = ['uploaded', 'uploaded', 'uploaded', ''];
      const stock = { gallery0: DEMO_GALLERY_STOCK[0], gallery1: DEMO_GALLERY_STOCK[1], gallery2: DEMO_GALLERY_STOCK[2] };
      expect(eligiblePages(base({ gallery: slots }), { imageUrls: stock })).not.toContain('gallery');
      const mine = { gallery0: 'https://i.example.com/a.jpg', gallery1: 'https://i.example.com/b.jpg', gallery2: 'https://i.example.com/c.jpg' };
      expect(eligiblePages(base({ gallery: slots }), { imageUrls: mine })).toContain('gallery');
      expect(ownGallerySlots(base({ gallery: slots }), { imageUrls: mine })).toEqual([0, 1, 2]);
    });
  });

  describe('Reviews', () => {
    const reviews = [{ author: 'A', rating: 5, comment: 'Great' }, { author: 'B', rating: 4, comment: 'Good' }];
    it('visible reviews only', () => {
      expect(eligiblePages(base({ reviews }))).toContain('reviews');
      expect(eligiblePages(base({ reviews: [] }))).not.toContain('reviews');
    });
    it('hidden-only reviews -> no Reviews page', () => {
      // reviewKey(): FNV-1a of "author\ncomment" lower-cased; compute through the helper the renderer uses.
      return import('../../lib/render/honest').then(({ reviewKey }) => {
        const hiddenReviews = reviews.map(reviewKey);
        expect(eligiblePages(base({ reviews, hiddenReviews }))).not.toContain('reviews');
        expect(eligiblePages(base({ reviews, hiddenReviews: [hiddenReviews[0]] }))).toContain('reviews');
      });
    });
  });

  describe('Hours & Location, Contact, Book, Shop', () => {
    it('hours -> Hours page; an address -> Location page (an address alone no longer makes an Hours page)', () => {
      expect(eligiblePages(base())).not.toContain('hours');
      expect(eligiblePages(base())).not.toContain('location');
      expect(eligiblePages(base({ hours: [{ day: 'Mon', open: '9', close: '5' }] }))).toContain('hours');
      expect(eligiblePages(base({ hours: [{ day: 'Mon', open: '9', close: '5' }] }))).not.toContain('location');
      const addr = eligiblePages(base({ contact: { address: '1 Main St', email: '' } }));
      expect(addr).toContain('location');
      expect(addr).not.toContain('hours');
      expect(eligiblePages(base({ contact: { address: '  ', email: '' } }))).not.toContain('location');
    });
    it('Contact needs a phone, an email, an address or a booking link', () => {
      expect(eligiblePages(base())).not.toContain('contact');
      expect(eligiblePages(base({ phone: '(512) 555-0100' }))).toContain('contact');
      expect(eligiblePages(base({ contact: { address: '', email: 'hi@example.com' } }))).toContain('contact');
      expect(eligiblePages(base({ bookingUrl: 'https://booksy.com/x' }))).toContain('contact');
      // the invented contact@shop.com address is not a contact
      expect(eligiblePages(base({ contact: { address: '', email: 'contact@freshcuts.com' } }))).not.toContain('contact');
    });
    it('Book only for the site\'s own /book page; Shop for any safe shop link', () => {
      expect(eligiblePages(base({ bookingUrl: '/book' }))).toContain('book');
      expect(eligiblePages(base({ bookingUrl: 'https://booksy.com/x' }))).not.toContain('book');
      expect(eligiblePages(base({ shopUrl: '/shop' }))).toContain('shop');
      expect(eligiblePages(base({ shopUrl: 'javascript:alert(1)' }))).not.toContain('shop');
    });
  });
});

describe('page set: order, hidden, files', () => {
  const full = (): WebsiteData => base({
    phone: '(512) 555-0100', bookingUrl: '/book', shopUrl: '/shop',
    about: { heading: 'About', description: ['Cutting hair since 1998.'], imageUrl: '' },
    services: [svc('Fade', { price: '$30' }), svc('Fade', { description: 'Second one' }), svc('Beard')],
    staff: [{ name: 'Sam', bio: 'x', memberId: MID }] as any,
    hours: [{ day: 'Mon', open: '9', close: '5' }],
    reviews: [{ author: 'A', rating: 5, comment: 'Great' }],
  });

  it('nav is eligible minus hidden, in order, home first', () => {
    const d = full();
    expect(buildPageSet(d).nav).toEqual(['home', 'about', 'services', 'team', 'reviews', 'hours', 'contact', 'book', 'shop']);
    expect(buildPageSet({ ...d, contact: { address: '1 Main St', email: '' } }).nav).toEqual(['home', 'about', 'services', 'team', 'reviews', 'hours', 'location', 'contact', 'book', 'shop']);
    const set = buildPageSet({ ...d, pages: { order: ['shop', 'team', 'about'], hidden: ['reviews', 'home'] } });
    expect(set.nav).toEqual(['home', 'shop', 'team', 'about', 'services', 'hours', 'contact', 'book']);
    expect(set.hidden).toEqual(['reviews']);
    expect(set.eligible).toContain('reviews');
  });
  it('a hidden page has no file, and hiding a group drops its per-item pages', () => {
    const set = buildPageSet({ ...full(), pages: { order: [], hidden: ['services', 'team'] } });
    expect(set.files.map((f) => f.path)).toEqual(['index.html', 'about/index.html', 'reviews/index.html', 'hours/index.html', 'contact/index.html']);
  });
  it('the file list of a full site', () => {
    expect(buildPageSet(full()).files.map((f) => f.path)).toEqual([
      'index.html', 'about/index.html', 'services/index.html', 'services/fade/index.html', 'services/fade-2/index.html', 'services/beard/index.html',
      'team/index.html', 'team/sam/index.html', 'reviews/index.html', 'hours/index.html', 'contact/index.html',
    ]);
  });
  it('book and shop are never files', () => {
    const paths = buildPageSet(full()).files.map((f) => f.path);
    expect(paths.some((p) => /^(book|shop)\//.test(p))).toBe(false);
    expect(pagePath('book')).toBeNull();
    expect(pagePath('shop')).toBeNull();
  });
  it('slugs stay stable when another item gains or loses a page', () => {
    const d = full();
    d.services[1] = svc('Fade'); // the second Fade keeps its page and its address
    expect(buildPageSet(d).services.map((s) => s.slug)).toEqual(['fade', 'fade-2', 'beard']);
    d.services[0] = svc(''); // a service losing its title loses its page (and a later same-name service takes the plain slug)
    expect(buildPageSet(d).services.map((s) => s.slug)).toEqual(['fade', 'beard']);
  });
  it('pageList lists the eligible pages with their state; home is locked', () => {
    const list = pageList({ ...full(), pages: { order: [], hidden: ['reviews'] } });
    expect(list[0]).toMatchObject({ key: 'home', on: true, locked: true, href: '/' });
    expect(list.find((p) => p.key === 'reviews')).toMatchObject({ on: false, href: '/reviews/' });
    expect(list.find((p) => p.key === 'services')?.children).toBe(3);
  });
  it('pageFileFor finds a page or one of its items', () => {
    const set = buildPageSet(full());
    expect(pageFileFor(set, 'about')?.path).toBe('about/index.html');
    expect(pageFileFor(set, 'services', 'fade-2')?.path).toBe('services/fade-2/index.html');
    expect(pageFileFor(set, 'gallery')).toBeUndefined();
  });
});

describe('pages model is untrusted JSON', () => {
  it.each([
    [undefined, { order: [], hidden: [] }],
    [null, { order: [], hidden: [] }],
    ['x', { order: [], hidden: [] }],
    [{ order: 'about', hidden: { a: 1 } }, { order: [], hidden: [] }],
    [{ order: ['about', 'about', 'nope', 7, '../x', 'team'], hidden: ['home', 'shop', 'shop', {}] }, { order: ['about', 'team'], hidden: ['shop'] }],
  ])('%j', (raw, expected) => {
    expect(cleanPagesModel(raw)).toEqual(expected);
  });
});

describe('slugify and reserved paths', () => {
  it('two "Fade" services -> fade, fade-2', () => {
    const taken = new Set<string>();
    expect(uniqueSlug('Fade', 'services', 1, taken)).toBe('fade');
    expect(uniqueSlug('Fade', 'services', 2, taken)).toBe('fade-2');
    expect(uniqueSlug('fade!', 'services', 3, taken)).toBe('fade-3');
  });
  it.each([
    ['Skin Fade & Beard', 'skin-fade-beard'],
    ['Crème Brûlée Cut', 'creme-brulee-cut'],
    ['  --Hot  Towel--  ', 'hot-towel'],
    ['Kids (under 12)', 'kids-under-12'],
    ['⁣ab⁣Fade⁣/⁣', 'fade'],
    ['ＦＡＤＥ', 'fade'],
  ])('%s -> %s', (raw, slug) => expect(slugify(raw, 'services', 1)).toBe(slug));
  it.each(['✂️💈', 'Тест', '理髪', '', '...', '..', '../../etc/passwd/', '/', '.', null, undefined])('%j -> a safe <group>-<n> or clean slug', (raw) => {
    const s = slugify(raw as any, 'team', 4);
    expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    expect(s).not.toMatch(/\.|\//);
    if (!/[a-z0-9]/i.test(String(raw ?? ''))) expect(s).toBe('team-4');
  });
  it('a path-traversal name is reduced to its words', () => expect(slugify('../../etc/passwd', 'team', 1)).toBe('etc-passwd'));
  it('is capped at 60 characters, with no trailing dash', () => {
    const s = slugify(`${'a'.repeat(59)} b`, 'services', 1);
    expect(s.length).toBeLessThanOrEqual(60);
    expect(s.endsWith('-')).toBe(false);
    const u = uniqueSlug('a'.repeat(80), 'services', 1, new Set(['a'.repeat(60)]));
    expect(u.length).toBeLessThanOrEqual(60);
    expect(u.endsWith('-2')).toBe(true);
  });
  it('the reserved top-level paths', () => {
    for (const r of ['book', 'shop', '_ab', 'api', 'manage', 'ab-site.json', 'sitemap.xml', 'robots.txt', 'index.html', 'styles.css', 'vercel.json']) {
      expect(RESERVED_PATHS).toContain(r);
      expect(isReservedPath(r)).toBe(true);
    }
    expect(isReservedPath('BOOK')).toBe(true);
    expect(isReservedPath('about')).toBe(false);
  });
  it('assertSiteFilePath allows only index.html, <page>/index.html and <group>/<slug>/index.html', () => {
    for (const ok of ['index.html', 'about/index.html', 'services/fade-2/index.html', 'team/sam/index.html']) expect(() => assertSiteFilePath(ok)).not.toThrow();
    for (const bad of [
      'book/index.html', 'shop/index.html', '_ab/index.html', 'api/index.html', 'manage/index.html', 'styles.css', 'vercel.json', 'ab-site.json',
      'sitemap.xml', '../index.html', 'a/../index.html', './index.html', '/index.html', 'about//index.html', 'about/index.htm', 'About/index.html',
      'a/b/c/index.html', 'about/x.html', 'a b/index.html', '', 'about\\index.html',
    ]) expect(() => assertSiteFilePath(bad), bad).toThrow();
  });
  it('pagePath refuses a bad slug', () => {
    expect(() => pagePath('services', '../x')).toThrow();
    expect(pagePath('services', 'fade')).toBe('services/fade/index.html');
  });
});

describe('pageHref', () => {
  it('is root-absolute, built from the page set only', () => {
    expect(pageHref('home')).toBe('/');
    expect(pageHref('about')).toBe('/about/');
    expect(pageHref('hours')).toBe('/hours/');
    expect(pageHref('services', 'fade')).toBe('/services/fade/');
    expect(pageHref('team', 'sam-fade')).toBe('/team/sam-fade/');
    expect(pageHref('book')).toBe('/book');
    expect(pageHref('shop')).toBe('/shop');
  });
  it('a slug that is not a clean slug falls back to the group page; a slug on another page is ignored', () => {
    expect(pageHref('services', '../../x')).toBe('/services/');
    expect(pageHref('team', 'a/b')).toBe('/team/');
    expect(pageHref('about', 'x')).toBe('/about/');
  });
});

describe('plainText', () => {
  it('drops editor markers', () => {
    expect(plainText('⁣ab⁣Hello⁣/⁣')).toBe('Hello');
    expect(plainText('a⁣b')).toBe('ab');
    expect(plainText(5 as any)).toBe('');
  });
});

describe('canonical base and sitemap', () => {
  it('a verified custom domain wins over the stored vercel.app base', () => {
    expect(canonicalBase({ customDomain: 'www.freshcuts.com', siteBaseUrl: 'https://fresh-cuts.vercel.app' })).toBe('https://www.freshcuts.com');
    expect(canonicalBase({ customDomain: 'https://FreshCuts.com/', siteBaseUrl: 'https://fresh-cuts.vercel.app' })).toBe('https://freshcuts.com');
  });
  it('else the stored base; else null', () => {
    expect(canonicalBase({ siteBaseUrl: 'https://fresh-cuts.vercel.app' })).toBe('https://fresh-cuts.vercel.app');
    expect(canonicalBase({ customDomain: null, siteBaseUrl: null })).toBeNull();
    expect(canonicalBase({})).toBeNull();
  });
  it('a custom domain that is itself a vercel.app host is not a custom domain', () => {
    expect(canonicalBase({ customDomain: 'x.vercel.app', siteBaseUrl: 'https://real.vercel.app' })).toBe('https://real.vercel.app');
  });
  it.each(['http://freshcuts.com', 'https://freshcuts.com/path', 'https://freshcuts.com:8443', 'javascript:alert(1)', 'https://', 'a b.com', '//evil.com'])(
    'refuses %s', (bad) => expect(canonicalBase({ siteBaseUrl: bad })).toBeNull(),
  );
  it('sitemap lists the nav pages, per-item pages and the proxied book/shop; XML-escaped; null without a base', () => {
    const d = base({
      bookingUrl: '/book', shopUrl: '/shop', phone: '1',
      services: [svc('Fade & Taper', { price: '$30' })],
    });
    const set = buildPageSet(d);
    const xml = sitemapXml(set, 'https://freshcuts.com') as string;
    const locs = [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([
      'https://freshcuts.com/', 'https://freshcuts.com/services/', 'https://freshcuts.com/services/fade-taper/',
      'https://freshcuts.com/contact/', 'https://freshcuts.com/book', 'https://freshcuts.com/shop',
    ]);
    expect(sitemapXml(set, null)).toBeNull();
    expect(sitemapXml(set, 'http://insecure.com')).toBeNull();
  });
  it('an external shop link is not in the sitemap, and hidden pages are not', () => {
    const d = base({ shopUrl: 'https://store.example.com', phone: '1', pages: { order: [], hidden: ['contact'] } });
    const xml = sitemapXml(buildPageSet(d), 'https://x.com') as string;
    expect(xml).not.toContain('/shop');
    expect(xml).not.toContain('/contact/');
  });
});
