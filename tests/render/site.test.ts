import { readFileSync } from 'fs';
import { join } from 'path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderSite, renderSiteBundle } from '../../lib/render/site';
import { generateHTMLWithPlaceholders } from '../../lib/render/luxe';
import { generatePrimeHTMLWithPlaceholders } from '../../lib/render/prime';
import { generateEuphoriaHTMLWithPlaceholders } from '../../lib/render/euphoria';
import { DEMO_GALLERY_STOCK } from '../../lib/stockImages';
import type { TemplateId, WebsiteData } from '../../types';

const MID = '3f2b8c1e-4a5d-4e6f-8a9b-0c1d2e3f4a5b';
const TEMPLATES: TemplateId[] = ['luxe', 'prime', 'euphoria'];
beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-01T00:00:00Z')); });
afterAll(() => { vi.useRealTimers(); });

const full = (extra: Partial<WebsiteData> = {}): WebsiteData => ({
  shopName: 'Fresh Cuts', area: 'Austin, TX', phone: '(512) 555-0100', bookingUrl: '/book', shopUrl: '/shop', template: 'luxe',
  hero: { heading: 'Fresh Cuts', tagline: 'Walk-ins welcome', imageUrl: 'https://i.example.com/h.jpg' },
  about: { heading: 'About', description: ['Cutting hair on Main Street since 1998.'], imageUrl: '' },
  services: [
    { title: 'Skin Fade', subtitle: '', description: 'Tight fade.', icon: 'scissors', imageUrl: '', price: '$35', duration: '45 min' },
    { title: 'Beard', subtitle: '', description: '', icon: 'scissors', imageUrl: '' },
  ],
  gallery: ['https://i.example.com/g0.jpg', 'https://i.example.com/g1.jpg', 'https://i.example.com/g2.jpg'],
  reviews: [{ author: 'Al', rating: 5, comment: 'Great cut' }], aggregateRating: { rating: 4.8, count: 120 }, reviewsSource: 'Google',
  hours: [{ day: 'Mon', open: '09:00', close: '17:00' }, { day: 'Sun', open: '', close: '', closed: true }],
  staff: [{ name: 'Sam Fade', role: 'Owner', photo: 'https://i.example.com/s.jpg', bio: 'Fades.', memberId: MID, serviceIds: ['x'], serviceNames: ['Skin Fade', 'Beard'] }],
  contact: { address: '1 Main St, Austin, TX', email: 'hi@fresh.com' },
  pages: { order: [], hidden: [] }, // multi-page is opt-in (P3b review B1)
  ...extra,
});

const FULL_PATHS = [
  'index.html', 'about/index.html', 'services/index.html', 'services/skin-fade/index.html', 'services/beard/index.html', 'team/index.html', 'team/sam-fade/index.html',
  'gallery/index.html', 'reviews/index.html', 'hours/index.html', 'location/index.html', 'contact/index.html',
];
const navLinks = (html: string): string[] => {
  const nav = /<nav class="ab-nav"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
  return [...nav.matchAll(/<a href="([^"]*)"/g)].map((m) => m[1]);
};

describe.each(TEMPLATES)('%s multi-page site', (template) => {
  const data = full({ template });

  it('file list of a full site', () => {
    expect(renderSite(data, template).map((f) => f.path)).toEqual(FULL_PATHS);
  });

  it('the menu on every page = eligible minus turned off, in order; current page marked', () => {
    const files = renderSite({ ...data, pages: { order: ['contact', 'about'], hidden: ['reviews'] } }, template);
    const expected = ['/', '/contact/', '/about/', '/services/', '/team/', '/gallery/', '/hours/', '/location/', '/book', '/shop'];
    for (const f of files) {
      // More than 5 items: the first 5, then the rest twice (flat for phones, and in the More dropdown) - Phase A of pages v2.
      expect(navLinks(f.html), f.path).toEqual([...expected, ...expected.slice(5)]);
      const current = [...new Set([...f.html.matchAll(/<a href="([^"]*)" class="is-active" aria-current="page"/g)].map((m) => m[1]))]; // an item under More is in both copies
      const want = f.path === 'index.html' ? '/' : '/' + f.path.split('/')[0] + '/'; // a service page highlights Services
      expect(current, f.path).toEqual([want]);
    }
    expect(files.map((f) => f.path)).not.toContain('reviews/index.html');
  });

  it('has a menu button that needs no script, and loads no script of its own', () => {
    for (const f of renderSite(data, template)) {
      expect(f.html).toContain('class="ab-nav-toggle"');
      expect(f.html).toContain('for="ab-nav-toggle"');
    }
    const nested = renderSite(data, template)[1].html;
    expect(nested.match(/<script/g)?.length).toBe(1); // the analytics tag only
  });

  it('every nested page links /styles.css and has no relative or anchor links (only #top)', () => {
    for (const f of renderSite(data, template).slice(1)) {
      expect(f.html, f.path).toContain('<link rel="stylesheet" href="/styles.css">');
      expect(f.html, f.path).not.toContain('href="styles.css"');
      for (const m of f.html.matchAll(/href="([^"]*)"/g)) {
        const h = m[1];
        if (h === '#top') continue;
        expect(h, `${f.path}: ${h}`).toMatch(/^(\/|https?:\/\/|tel:|mailto:)/);
        expect(h.startsWith('//'), h).toBe(false);
      }
      expect(f.html.includes('href="#') && !/href="#top"/.test(f.html)).toBe(false);
    }
  });

  it('home keeps its sections and anchors', () => {
    const home = renderSite(data, template)[0].html;
    expect(home).toContain('id="services"');
    expect(home).toContain('id="team"');
    if (template === 'luxe') { expect(home).toContain('id="contact"'); expect(home).toContain('id="home"'); } else expect(home).toContain('id="top"');
  });

  it('a site with Home alone (or no page set) is the single-page renderer, byte for byte', () => {
    const gen = { luxe: generateHTMLWithPlaceholders, prime: generatePrimeHTMLWithPlaceholders, euphoria: generateEuphoriaHTMLWithPlaceholders }[template];
    const bare = full({ template, services: [], gallery: [], reviews: [], aggregateRating: undefined, hours: [], staff: [], phone: '', bookingUrl: '', shopUrl: '', contact: { address: '', email: '' }, about: { heading: 'About', description: [], imageUrl: '' } });
    const files = renderSite(bare, template);
    expect(files.map((f) => f.path)).toEqual(['index.html']);
    const norm = (h: string) => h.replace(/<meta name="published-at" content="\d+">/, '');
    expect(norm(files[0].html)).toBe(norm(gen({ ...bare, hero: { ...bare.hero, imageUrl: 'has-image' }, about: { ...bare.about, imageUrl: '' }, gallery: [], staff: [] })));
    expect(files[0].html).not.toContain('ab-nav');
    // and the plain generator with no ctx never shows page links, even for a site with pages
    expect(gen(data)).not.toContain('class="ab-nav"');
  });

  it('a shop name that tries to break out is escaped in every page title and meta tag', () => {
    const evil = '"><script>alert(1)</script>';
    const files = renderSite({ ...data, shopName: evil, area: '"><img src=x onerror=alert(2)>' }, template, { siteBaseUrl: 'https://x.vercel.app' });
    for (const f of files) {
      expect(f.html, f.path).not.toContain('<script>alert');
      expect(f.html, f.path).not.toContain('<img src=x');
      const title = /<title>([^<]*)<\/title>/.exec(f.html)?.[1] ?? '';
      expect(title, f.path).toContain('&quot;&gt;&lt;script&gt;');
      for (const m of f.html.matchAll(/<meta (?:name|property)="(?:description|og:[a-z]+)" content="([^"]*)"/g)) expect(m[1]).not.toMatch(/[<>]/);
    }
  });

  it('labels the barber edited show in the menu and the page title (escaped)', () => {
    const files = renderSite({ ...data, labels: { pgNavAbout: 'Our <story>', pgAboutTitle: 'The "story"' } }, template);
    const about = files.find((f) => f.path === 'about/index.html')!.html;
    expect(about).toContain('Our &lt;story&gt;');
    expect(about).toContain('<title>The &quot;story&quot; · Fresh Cuts</title>');
    expect(about).toContain('<h1 class="ab-h1">The &quot;story&quot;</h1>');
  });

  it('prints only what the barber gave us: no generated About text, no stock gallery photos', () => {
    const files = renderSite(full({
      template,
      about: { heading: 'About the Shop', description: ['Fresh Cuts is a barbershop in Austin, TX.', 'Get in touch to book your next appointment.'], imageUrl: '' },
      gallery: [...DEMO_GALLERY_STOCK],
    }), template);
    const paths = files.map((f) => f.path);
    expect(paths).not.toContain('about/index.html');
    expect(paths).not.toContain('gallery/index.html');
  });

  it('book and shop are links, never files', () => {
    const paths = renderSite(data, template).map((f) => f.path);
    expect(paths.some((p) => /^(book|shop)/.test(p))).toBe(false);
  });

  it('hostile service and barber names make safe paths and escaped pages', () => {
    const files = renderSite(full({
      template,
      services: [{ title: '../../etc/passwd</h1><script>x()</script>', subtitle: '', description: 'd', icon: 'scissors', imageUrl: '' }, { title: '💈', subtitle: '', price: '$5', description: '', icon: 'scissors', imageUrl: '' }],
      staff: [{ name: '..', bio: 'b' }, { name: '/', bio: 'c' }],
    }), template);
    for (const f of files) expect(f.path).toMatch(/^(index\.html|[a-z0-9-]+\/index\.html|[a-z0-9-]+\/[a-z0-9-]+\/index\.html)$/);
    expect(files.map((f) => f.path)).toEqual(expect.arrayContaining(['services/etc-passwd-h1-script-x-script/index.html', 'services/services-2/index.html', 'team/team-1/index.html', 'team/team-2/index.html']));
    for (const f of files) expect(f.html).not.toContain('<script>x()');
  });

  it('photos are {{placeholders}} the deploy fills, per page', () => {
    const files = renderSite(data, template);
    expect(files.find((f) => f.path === 'gallery/index.html')!.html).toContain('{{gallery2}}');
    expect(files.find((f) => f.path === 'team/index.html')!.html).toContain('{{staff0}}');
    expect(files.find((f) => f.path === 'team/sam-fade/index.html')!.html).toContain('{{staff0}}');
  });

  it('pending shape: stock photos in imageUrls do not make a Gallery page', () => {
    const pending = full({ template, gallery: ['uploaded', 'uploaded', 'uploaded'] });
    const stock = Object.fromEntries([0, 1, 2].map((i) => [`gallery${i}`, DEMO_GALLERY_STOCK[i]]));
    expect(renderSite(pending, template, { imageUrls: stock }).map((f) => f.path)).not.toContain('gallery/index.html');
    const own = Object.fromEntries([0, 1, 2].map((i) => [`gallery${i}`, `https://i.example.com/own${i}.jpg`]));
    expect(renderSite(pending, template, { imageUrls: own }).map((f) => f.path)).toContain('gallery/index.html');
  });
});

describe('canonical links and sitemap', () => {
  const data = full();
  it('no base known: no canonical on any page and no sitemap', () => {
    const r = renderSiteBundle(data);
    expect(r.sitemap).toBeNull();
    for (const f of r.pages) expect(f.html).not.toContain('rel="canonical"');
  });
  it('the stored base gives each page its own canonical and the sitemap lists the same pages', () => {
    const r = renderSiteBundle(data, { siteBaseUrl: 'https://fresh-cuts.vercel.app' });
    for (const f of r.pages) {
      const href = f.path === 'index.html' ? '/' : '/' + f.path.replace(/index\.html$/, '');
      expect(f.html, f.path).toContain(`<link rel="canonical" href="https://fresh-cuts.vercel.app${href}">`);
    }
    const locs = [...(r.sitemap as string).matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1].replace('https://fresh-cuts.vercel.app', ''));
    expect(locs).toEqual([...r.set.files.map((f) => f.href), '/book', '/shop']);
  });
  it('a verified custom domain wins over vercel.app', () => {
    const r = renderSiteBundle(data, { customDomain: 'freshcuts.com', siteBaseUrl: 'https://fresh-cuts.vercel.app' });
    for (const f of r.pages) { expect(f.html).toContain('href="https://freshcuts.com/'); expect(f.html).not.toContain('vercel.app/'); }
    expect(r.sitemap).toContain('https://freshcuts.com/about/');
    expect(r.sitemap).not.toContain('vercel.app');
  });
  it('a turned-off page is in neither', () => {
    const r = renderSiteBundle({ ...data, pages: { order: [], hidden: ['about'] } }, { siteBaseUrl: 'https://x.vercel.app' });
    expect(r.sitemap).not.toContain('/about/');
  });
});

describe('page content', () => {
  const byPath = (files: { path: string; html: string }[], p: string) => files.find((f) => f.path === p)!.html;
  const files = renderSite(full());
  it('service page: its own description, price and duration; link back; book button', () => {
    const h = byPath(files, 'services/skin-fade/index.html');
    expect(h).toContain('Tight fade.'); expect(h).toContain('$35'); expect(h).toContain('45 min');
    expect(h).toContain('href="/services/"'); expect(h).toContain('href="/book"');
  });
  it('services page links every service (each has a page)', () => {
    const h = byPath(files, 'services/index.html');
    expect(h).toContain('href="/services/skin-fade/"');
    expect(h).toContain('href="/services/beard/"');
    const main = /<main[\s\S]*<\/main>/.exec(h)![0]; // the footer lists the service pages too
    expect(main.match(/href="\/services\/[a-z0-9-]+\/"/g)).toHaveLength(2);
  });
  it('team member page: bio, picked services with prices, book with <first name> to /book?barber=', () => {
    const h = byPath(files, 'team/sam-fade/index.html');
    expect(h).toContain('Fades.'); expect(h).toContain('$35'); expect(h).toContain(`href="/book?barber=${MID}"`); expect(h).toContain('Book with Sam');
  });
  it('a member with no service subset lists no services (all-services is inherited)', () => {
    const f = renderSite(full({ staff: [{ name: 'Sam Fade', bio: 'Fades.' }] }));
    expect(byPath(f, 'team/sam-fade/index.html')).not.toContain('<div class="ab-rows">');
  });
  it('hours page: rows and Closed; the address and map moved to the Location page', () => {
    const h = byPath(files, 'hours/index.html');
    const main = /<main[\s\S]*<\/main>/.exec(h)![0]; // the footer now prints the address
    expect(h).toContain('9:00 AM'); expect(h).toContain('Closed'); expect(h).not.toContain('maps.google.com'); expect(main).not.toContain('1 Main St');
  });
  it('reviews page: visible reviews, source, rating', () => {
    const h = byPath(files, 'reviews/index.html');
    expect(h).toContain('Great cut'); expect(h).toContain('Reviews from Google'); expect(h).toContain('4.8 from 120 reviews');
    const hidden = byPath(renderSite(full({ display: { rating: 'hide' } })), 'reviews/index.html');
    expect(hidden).not.toContain('4.8');
  });
  it('contact page: tel and mailto links, the invented email is not shown', () => {
    const h = byPath(files, 'contact/index.html');
    expect(h).toContain('href="tel:(512)555-0100"'); expect(h).toContain('href="mailto:hi@fresh.com"');
    const inv = renderSite(full({ contact: { address: '1 Main St', email: 'contact@freshcuts.com' } }));
    expect(byPath(inv, 'contact/index.html')).not.toContain('contact@freshcuts.com');
  });
  it('a hidden review does not appear on the reviews page', async () => {
    const { reviewKey } = await import('../../lib/render/honest');
    const reviews = [{ author: 'Al', rating: 5, comment: 'Great cut' }, { author: 'Bo', rating: 4, comment: 'Fine work' }];
    const f = renderSite(full({ reviews, hiddenReviews: [reviewKey(reviews[0])] }));
    const h = byPath(f, 'reviews/index.html');
    expect(h).not.toContain('Great cut'); expect(h).toContain('Fine work');
  });
});

describe('multi-page is opt-in (P3b review B1)', () => {
  const golden = JSON.parse(readFileSync(join(__dirname, 'fixtures/prep3b-single-page.json'), 'utf8')) as Record<string, string>;
  const imageUrls = { hero: 'https://i.example.com/h.jpg', gallery0: 'https://i.example.com/g0.jpg', gallery1: 'https://i.example.com/g1.jpg', gallery2: 'https://i.example.com/g2.jpg', staff0: 'https://i.example.com/s.jpg' };
  const pending = (template: TemplateId): WebsiteData => {
    const d = full({ template, hero: { heading: 'Fresh Cuts', tagline: 'Walk-ins welcome', imageUrl: 'x' }, gallery: ['x', 'x', 'x'] });
    delete d.pages;
    d.staff = d.staff!.map((s) => ({ ...s, photo: 'x' }));
    return d;
  };
  it.each(TEMPLATES)('%s: a stored site with no pages renders ONLY index.html, identical to the pre-P3b output', (template) => {
    const data = pending(template);
    expect(data.pages).toBeUndefined();
    const r = renderSiteBundle(data, { imageUrls });
    expect(r.pages.map((f) => f.path)).toEqual(['index.html']);
    expect(r.pages[0].html).toBe(golden[template]);
    expect(r.sitemap).toBeNull();
  });
  it.each(TEMPLATES)('%s: extraPages, copy, pageSections and the new labels (pages v2, Phase A) do not move one byte of a single page', (template) => {
    const data: WebsiteData = {
      ...pending(template),
      extraPages: { on: ['faq', 'first-visit', 'hair-care', 'beard-care'], serviceGuides: true, seed: 5, pick: { a: 1 }, images: { faq: 'https://x/y.jpg' } },
      copy: { 'guide.fade.what': 'Hello <script>', 'faq.intro': 'x' },
      pageSections: { service: { hidden: ['guide'], order: ['hero'] } },
      labels: { pgPlace: 'Elsewhere', pgMore: 'Etc', pgPages: 'All' } as never,
    };
    const r = renderSiteBundle(data, { imageUrls });
    expect(r.pages.map((f) => f.path)).toEqual(['index.html']);
    expect(r.pages[0].html).toBe(golden[template]);
    expect(r.sitemap).toBeNull();
  });
  it.each(TEMPLATES)('%s: page hero photos (service imageUrl, extraPages.images, their map keys, sections) do not move one byte of a single page (Phase C)', (template) => {
    const base = pending(template);
    const data: WebsiteData = {
      ...base,
      services: base.services.map((s) => ({ ...s, imageUrl: 'https://i.example.com/svc.jpg' })),
      extraPages: { on: ['first-visit', 'hair-care'], serviceGuides: true, seed: 5, images: { 'first-visit': 'https://i.example.com/p.jpg', 'hair-care': 'uploaded' } },
      pageSections: { 'first-visit': { hidden: ['hero'], order: ['cta'] }, service: { hidden: ['guide'] } },
    };
    const urls = { ...imageUrls, service0: 'https://i.example.com/svc.jpg', 'page-first-visit': 'https://i.example.com/p.jpg' };
    const r = renderSiteBundle(data, { imageUrls: urls });
    expect(r.pages.map((f) => f.path)).toEqual(['index.html']);
    expect(r.pages[0].html).toBe(golden[template]);
    const r2 = renderSiteBundle(data);
    expect(r2.pages.map((f) => f.path)).toEqual(['index.html']);
    expect(r2.pages[0].html.replace(/published-at" content="\d+"/, '')).toBe(golden[template].replace(/published-at" content="\d+"/, ''));
  });
  it.each(TEMPLATES)('%s: with pages present the page set is built', (template) => {
    const r = renderSiteBundle({ ...pending(template), pages: { order: [], hidden: [] } }, { imageUrls });
    expect(r.pages.length).toBeGreaterThan(1);
  });
});

describe('single-page output is unchanged once a base is stored (P3b review S4)', () => {
  const golden = JSON.parse(readFileSync(join(__dirname, 'fixtures/prep3b-single-page.json'), 'utf8')) as Record<string, string>;
  const imageUrls = { hero: 'https://i.example.com/h.jpg', gallery0: 'https://i.example.com/g0.jpg', gallery1: 'https://i.example.com/g1.jpg', gallery2: 'https://i.example.com/g2.jpg', staff0: 'https://i.example.com/s.jpg' };
  const BASE = { siteBaseUrl: 'https://fresh-cuts.vercel.app', customDomain: 'freshcuts.com' };
  it.each(TEMPLATES)('%s: no pages field + a stored base -> pre-P3b home, no canonical, no sitemap', (template) => {
    const d = full({ template, hero: { heading: 'Fresh Cuts', tagline: 'Walk-ins welcome', imageUrl: 'x' }, gallery: ['x', 'x', 'x'] });
    delete d.pages;
    d.staff = d.staff!.map((s) => ({ ...s, photo: 'x' }));
    const r = renderSiteBundle(d, { imageUrls, ...BASE });
    expect(r.pages.map((f) => f.path)).toEqual(['index.html']);
    expect(r.pages[0].html).toBe(golden[template]);
    expect(r.sitemap).toBeNull();
  });
  it.each(TEMPLATES)('%s: pages present but every page off + a base -> no canonical, no sitemap', (template) => {
    const r = renderSiteBundle(full({ template, pages: { order: [], hidden: ['about', 'services', 'team', 'gallery', 'reviews', 'hours', 'location', 'contact'] } }), BASE);
    expect(r.pages.map((f) => f.path)).toEqual(['index.html']);
    expect(r.pages[0].html).not.toContain('rel="canonical"');
    expect(r.sitemap).toBeNull();
  });
});
