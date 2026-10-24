// Real per-service pages and the Location page (owner feedback 2026-10-24). Everything on them is the
// barber's own data; with no data there is no page.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { renderSite, renderSiteBundle } from '../../lib/render/site';
import { pageList } from '../../lib/render/pages';
import { visiblePageLabelKeys, LABELS } from '../../lib/render/labels';
import type { TemplateId, WebsiteData } from '../../types';

const MID = '3f2b8c1e-4a5d-4e6f-8a9b-0c1d2e3f4a5b';
const TEMPLATES: TemplateId[] = ['luxe', 'prime', 'euphoria'];
beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-01T00:00:00Z')); });
afterAll(() => { vi.useRealTimers(); });

const svc = (title: string, extra: Record<string, unknown> = {}) => ({ title, subtitle: '', description: '', icon: 'scissors' as const, imageUrl: '', ...extra });
const shop = (extra: Partial<WebsiteData> = {}): WebsiteData => ({
  shopName: 'Fresh Cuts', area: 'Austin, TX', phone: '(512) 555-0100', bookingUrl: '/book', template: 'luxe',
  hero: { heading: 'Fresh Cuts', tagline: 'Walk-ins welcome', imageUrl: '' },
  about: { heading: 'About', description: [], imageUrl: '' },
  services: [svc('Skin Fade', { price: '$35', duration: '45 min', description: 'Tight fade.' }), svc('Beard'), svc('Line Up')],
  gallery: [], hours: [{ day: 'Mon', open: '09:00', close: '17:00' }, { day: 'Sun', open: '', close: '', closed: true }],
  staff: [
    { name: 'Sam Fade', memberId: MID, serviceIds: ['a'], serviceNames: ['skin fade', 'Beard'], bio: 'Fades.' },
    { name: 'Lee Everything', bio: 'Does it all.' }, // no explicit subset: not listed on any service
  ],
  contact: { address: '1 Main St, Austin, TX 78701', email: '' },
  pages: { order: [], hidden: [] },
  ...extra,
});
const at = (files: { path: string; html: string }[], p: string) => files.find((f) => f.path === p)?.html ?? '';
const visible = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');

describe.each(TEMPLATES)('%s: service and location pages', (template) => {
  const files = renderSite(shop({ template }), template);

  it('every titled service has a page; the Services page lists them all', () => {
    const paths = files.map((f) => f.path);
    expect(paths).toEqual(expect.arrayContaining(['services/skin-fade/index.html', 'services/beard/index.html', 'services/line-up/index.html', 'location/index.html']));
    const list = at(files, 'services/index.html');
    for (const s of ['skin-fade', 'beard', 'line-up']) expect(list).toContain(`href="/services/${s}/"`);
  });

  it('a service page: name, real price/duration/description, book button, back link, no photo, full shell', () => {
    const h = at(files, 'services/skin-fade/index.html');
    expect(h).toContain('<title>Skin Fade in Austin, TX · Fresh Cuts</title>'); // pages v2: the shop's place in the title
    expect(h).toContain('<h1 class="ab-h1">Skin Fade</h1>');
    expect(h).toContain('$35'); expect(h).toContain('45 min'); expect(h).toContain('Tight fade.');
    expect(h).toContain('href="/book"'); expect(h).not.toContain('/book?service');
    expect(h).toContain('href="/services/"'); expect(h).toContain('href="/styles.css"');
    expect(h).not.toContain('<img');
    expect(h).toContain('aria-current="page"');
  });

  it('a title-only service prints no price, duration or description (nothing invented)', () => {
    const h = at(files, 'services/beard/index.html');
    expect(h).toContain('<h1 class="ab-h1">Beard</h1>');
    expect(h).not.toContain('class="ab-price"'); expect(h).not.toContain('class="ab-meta"'); expect(h).not.toContain('<div class="ab-prose"><p>');
  });

  it('who does it: only barbers with an explicit subset naming the service; linked when they have a page', () => {
    const h = at(files, 'services/skin-fade/index.html');
    expect(h).toContain('Offered by'); expect(h).toContain('href="/team/sam-fade/"');
    expect(h).not.toContain('Lee Everything');
    const none = at(files, 'services/line-up/index.html');
    expect(none).not.toContain('Offered by');
  });

  it('related links: other services, Location, Hours, Contact', () => {
    const h = at(files, 'services/skin-fade/index.html');
    expect(h).toContain('Other services'); expect(h).toContain('href="/services/beard/"'); expect(h).not.toMatch(/Other services[\s\S]*href="\/services\/skin-fade\/"[\s\S]*<\/main>/);
    for (const href of ['/location/', '/hours/', '/contact/']) expect(h).toContain(`href="${href}"`);
  });

  it('the location page: facts, directions link, map, hours, book; title from the real address', () => {
    const h = at(files, 'location/index.html');
    expect(h).toContain('<title>Barbershop in Austin, TX · Fresh Cuts</title>');
    expect(h).toContain('<meta name="description" content="Fresh Cuts, 1 Main St, Austin, TX 78701.">');
    expect(h).toContain('href="https://www.google.com/maps/search/?api=1&amp;query=1%20Main%20St%2C%20Austin%2C%20TX%2078701"');
    expect(h).toContain('maps.google.com/maps?q=Fresh%20Cuts%201%20Main%20St');
    expect(h).toContain('9:00 AM'); expect(h).toContain('Closed'); expect(h).toContain('tel:(512)555-0100');
    expect(h).toContain('href="/book"'); expect(h).toContain('Get directions');
    expect(h).toContain('href="/styles.css"'); expect(h).toContain('aria-current="page"');
    expect(h).not.toMatch(/parking/i);
  });

  it('nav lists Location, highlighted on its own page only', () => {
    const nav = (h: string) => [...(/<nav class="ab-nav"[\s\S]*?<\/nav>/.exec(h)?.[0] ?? '').matchAll(/<a href="([^"]*)"( class="is-active")?/g)].map((m) => [m[1], !!m[2]]);
    expect(nav(at(files, 'location/index.html'))).toContainEqual(['/location/', true]);
    expect(nav(at(files, 'index.html'))).toContainEqual(['/location/', false]);
    // a service page highlights Services
    expect(nav(at(files, 'services/beard/index.html'))).toContainEqual(['/services/', true]);
  });

  it('visible text of every new page contains none of the banned marketing words', () => {
    const BAN = /\b(premium|luxury|best|award|expert|world-class|state-of-the-art|unmatched|unrivaled|finest|top-rated|#1|guarantee)/i;
    for (const p of ['services/skin-fade/index.html', 'services/beard/index.html', 'location/index.html']) expect(visible(at(files, p)), p).not.toMatch(BAN);
  });
});

describe('honesty: no data, no page', () => {
  it('no services -> no Services page and no service pages; no address -> no Location page', () => {
    const files = renderSite(shop({ services: [], contact: { address: '', email: '' } }));
    const paths = files.map((f) => f.path);
    expect(paths.some((p) => p.startsWith('services'))).toBe(false);
    expect(paths).not.toContain('location/index.html');
    expect(at(files, 'index.html')).not.toContain('href="/location/"');
  });
  it('an address alone: Location but no Hours page; hours alone: Hours but no Location', () => {
    const a = renderSite(shop({ hours: [] })).map((f) => f.path);
    expect(a).toContain('location/index.html'); expect(a).not.toContain('hours/index.html');
    const h = renderSite(shop({ contact: { address: '', email: '' } })).map((f) => f.path);
    expect(h).toContain('hours/index.html'); expect(h).not.toContain('location/index.html');
  });
  it('location without hours or phone prints neither', () => {
    const h = at(renderSite(shop({ hours: [], phone: '' })), 'location/index.html');
    expect(h).not.toContain('Closed'); expect(h).not.toContain('tel:'); expect(h).not.toContain('>Hours<');
  });
  it('with no booking link the service and location pages have no book button', () => {
    const f = renderSite(shop({ bookingUrl: '' }));
    expect(at(f, 'services/beard/index.html')).not.toContain('Book now');
    expect(at(f, 'location/index.html')).not.toContain('Book now');
  });
  it('a barber-owned booking link opens in a new tab on service pages (shop link, never /book?service=)', () => {
    const h = at(renderSite(shop({ bookingUrl: 'https://booksy.com/x' })), 'services/beard/index.html');
    expect(h).toContain('href="https://booksy.com/x" target="_blank" rel="noopener noreferrer"');
  });
});

describe('opt-in and caps', () => {
  it('no pages field: Home alone, byte for byte the single-page renderer (no new page, no menu change)', () => {
    const d = shop(); delete d.pages;
    const files = renderSite(d);
    expect(files.map((f) => f.path)).toEqual(['index.html']);
    expect(at(files, 'index.html')).not.toContain('/location/');
    expect(at(files, 'index.html')).not.toContain('/services/');
  });
  it('more than 12 services: 12 pages; the rest are listed on the Services page without a link', () => {
    const services = Array.from({ length: 14 }, (_, i) => svc(`Cut ${i + 1}`));
    const r = renderSiteBundle(shop({ services }));
    expect(r.set.services).toHaveLength(12);
    expect(r.set.servicesOverCap).toBe(2);
    const list = at(r.pages, 'services/index.html');
    expect(list).toContain('Cut 14'); expect(list).not.toContain('href="/services/cut-14/"'); expect(list).toContain('href="/services/cut-12/"');
  });
  it('hidden Location and hidden Services drop their files and menu entries', () => {
    const f = renderSite(shop({ pages: { order: [], hidden: ['location', 'services'] } }));
    const paths = f.map((x) => x.path);
    expect(paths).not.toContain('location/index.html');
    expect(paths.some((p) => p.startsWith('services/'))).toBe(false);
    expect(at(f, 'about/index.html') + at(f, 'hours/index.html')).not.toContain('href="/location/"');
  });
  it('order moves Location in the menu', () => {
    const f = renderSite(shop({ pages: { order: ['location', 'services'], hidden: [] } }));
    const nav = [...(/<nav class="ab-nav"[\s\S]*?<\/nav>/.exec(at(f, 'index.html'))?.[0] ?? '').matchAll(/<a href="([^"]*)"/g)].map((m) => m[1]);
    expect(nav.slice(0, 3)).toEqual(['/', '/location/', '/services/']);
  });
  it('pageList (the app\'s Pages sheet) lists Location with its link, and Services counts the pages', () => {
    const list = pageList(shop());
    expect(list.find((p) => p.key === 'location')).toMatchObject({ on: true, href: '/location/' });
    expect(list.find((p) => p.key === 'services')?.children).toBe(3);
  });
});

describe('sitemap and canonical', () => {
  it('every service page and the location page are in the sitemap with their own canonical', () => {
    const r = renderSiteBundle(shop(), { siteBaseUrl: 'https://fresh-cuts.vercel.app' });
    for (const href of ['/services/skin-fade/', '/services/beard/', '/services/line-up/', '/location/']) {
      expect(r.sitemap).toContain(`<loc>https://fresh-cuts.vercel.app${href}</loc>`);
    }
    expect(at(r.pages, 'location/index.html')).toContain('<link rel="canonical" href="https://fresh-cuts.vercel.app/location/">');
    expect(at(r.pages, 'services/beard/index.html')).toContain('<link rel="canonical" href="https://fresh-cuts.vercel.app/services/beard/">');
    expect(renderSiteBundle(shop()).sitemap).toBeNull();
  });
});

describe('slugs and hostile text', () => {
  it('same-name services get fade, fade-2; a service called "book" or "api" stays under services/', () => {
    const f = renderSite(shop({ services: [svc('Fade'), svc('fade'), svc('Book'), svc('API'), svc('💈')] }));
    const paths = f.map((x) => x.path).filter((p) => p.startsWith('services/') && p !== 'services/index.html');
    expect(paths).toEqual(['services/fade/index.html', 'services/fade-2/index.html', 'services/book/index.html', 'services/api/index.html', 'services/services-5/index.html']);
  });
  it.each(TEMPLATES)('%s: markup in a service name, the shop name and the address is escaped everywhere', (template) => {
    const evil = '"><script>x()</script>';
    const f = renderSite(shop({
      template, shopName: `Cuts ${evil}`, contact: { address: `1 ${evil} St`, email: '' },
      services: [svc(`Fade ${evil}`, { description: `d ${evil}`, price: `$5${evil}` }), svc('Beard')],
      staff: [{ name: `Sam ${evil}`, serviceIds: ['a'], serviceNames: [`Fade ${evil}`], bio: 'b' }],
    }), template);
    for (const file of f) {
      expect(file.html, file.path).not.toContain('<script>x()');
      expect(file.html, file.path).not.toContain('"><script');
    }
    const loc = f.find((x) => x.path === 'location/index.html')!.html;
    expect(loc).toContain('&lt;script&gt;x()&lt;/script&gt;');
    expect(loc).toMatch(/<title>[^<]*&quot;&gt;&lt;script&gt;/);
  });
});

describe('labels: the app can edit every new text', () => {
  it('service and location pages expose their labels to the preview', () => {
    const d = shop();
    const loc = visiblePageLabelKeys(d, 'location');
    expect(loc).toEqual(expect.arrayContaining(['pgLocationTitle', 'pgDirectionsCta', 'pgAddressLabel', 'pgPhoneLabel', 'pgHoursHeading', 'pgClosed', 'pgBookCta', 'pgAlsoSee', 'pgNavLocation']));
    const svcKeys = visiblePageLabelKeys(d, 'services');
    expect(svcKeys).toEqual(expect.arrayContaining(['pgBackServices', 'pgBookCta', 'pgOfferedBy', 'pgOtherServices', 'pgAlsoSee']));
    for (const k of ['pgLocationTitle', 'pgDirectionsCta', 'pgOfferedBy', 'pgOtherServices', 'pgAlsoSee', 'pgNavLocation'] as const) expect(LABELS[k].max).toBeGreaterThan(0);
  });
  it('a renamed label shows on the page, escaped', () => {
    const f = renderSite(shop({ labels: { pgDirectionsCta: 'Take me <there>', pgLocationTitle: 'Come by' } as never }));
    const h = at(f, 'location/index.html');
    expect(h).toContain('Take me &lt;there&gt;'); expect(h).toContain('<h1 class="ab-h1">Come by</h1>'); expect(h).toContain('<title>Barbershop in Austin, TX · Fresh Cuts</title>');
  });
});

describe('review round 2', () => {
  it('S1: with Team turned off, a service page has no Offered by block and no link to an undeployed team page', () => {
    const f = renderSite(shop({ pages: { order: [], hidden: ['team'] } }));
    expect(f.map((x) => x.path).some((p) => p.startsWith('team/'))).toBe(false);
    const h = at(f, 'services/skin-fade/index.html');
    expect(h).not.toContain('/team/'); expect(h).not.toContain('Offered by');
  });
  it('S1: every internal link on every page points at a file that is deployed (or /book, /shop)', () => {
    for (const pages of [{ order: [], hidden: [] }, { order: [], hidden: ['team'] }, { order: [], hidden: ['location', 'hours'] }] as const) {
      const f = renderSite(shop({ pages: { order: [...pages.order], hidden: [...pages.hidden] } as never }));
      const paths = new Set(f.map((x) => x.path));
      for (const file of f) for (const m of file.html.matchAll(/href="(\/[^"#?]*)"/g)) {
        const h = m[1];
        if (h === '/' || h === '/book' || h === '/shop' || h === '/styles.css') continue;
        expect(paths.has(`${h.replace(/^\//, '')}index.html`), `${file.path} -> ${h}`).toBe(true);
      }
    }
  });
  it('S2: a setup saved before Location existed that hid Hours keeps Location off', () => {
    const old = shop({ hours: [], pages: { order: ['hours', 'contact'], hidden: ['hours'] } });
    const r = renderSiteBundle(old);
    expect(r.pages.map((x) => x.path)).not.toContain('location/index.html');
    expect(r.set.hidden).toContain('location');
    // the sheet can still list it, and turning it on (saved order now lists it) works
    expect(pageList(old).find((p) => p.key === 'location')?.on).toBe(false);
    const on = renderSite(shop({ hours: [], pages: { order: ['hours', 'contact', 'location'], hidden: [] } }));
    expect(on.map((x) => x.path)).toContain('location/index.html');
    // a model that lists location and hides only hours keeps Location on
    const f = renderSite(shop({ pages: { order: ['location'], hidden: ['hours'] } }));
    expect(f.map((x) => x.path)).toContain('location/index.html');
    // hidden hours with hours rows and no saved order: also treated as the old setup
    expect(renderSite(shop({ pages: { order: [], hidden: ['hours'] } })).map((x) => x.path)).not.toContain('location/index.html');
  });
  it('M3: the Hours page prints "Hours" once', () => {
    const h = at(renderSite(shop()), 'hours/index.html');
    expect(((/<main[\s\S]*<\/main>/.exec(h)?.[0] ?? '').replace(/<[^>]+>/g, ' ').match(/\bHours\b/g) ?? []).length).toBe(1);
    expect(h).not.toContain('<h2 class="ab-h2">Hours</h2>');
  });
});
