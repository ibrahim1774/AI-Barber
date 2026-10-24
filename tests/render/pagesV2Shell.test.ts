// Phase A: location-titled service pages, the 'More' menu and the full footer, deployed-pages-only links.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderSite, renderSiteBundle } from '../../lib/render/site';
import { navListHtml, footerHtml, NAV_CSS, type NavItem } from '../../lib/render/shell';
import { EXTRA_KEYS } from '../../lib/render/pages';
import type { TemplateId, WebsiteData } from '../../types';

const TEMPLATES: TemplateId[] = ['luxe', 'prime', 'euphoria'];
beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-01-01T00:00:00Z')); });
afterAll(() => { vi.useRealTimers(); });

const svc = (title: string, extra: Record<string, unknown> = {}) => ({ title, subtitle: '', description: '', icon: 'scissors' as const, imageUrl: '', ...extra });
const shop = (extra: Partial<WebsiteData> = {}): WebsiteData => ({
  shopName: 'Fresh Cuts', area: 'Brooklyn, NY', phone: '(512) 555-0100', bookingUrl: '/book', template: 'luxe',
  hero: { heading: 'Fresh Cuts', tagline: '', imageUrl: '' },
  about: { heading: 'About', description: [], imageUrl: '' },
  services: [svc('Skin Fade', { price: '$35', duration: '45 min' }), svc('Beard Trim', { price: '$15' }), svc('Line Up')],
  gallery: [], hours: [{ day: 'Mon', open: '09:00', close: '17:00' }],
  contact: { address: '1 Main St, Brooklyn, NY 11201', email: 'hi@fresh.com' },
  pages: { order: [], hidden: [] },
  ...extra,
});
const at = (files: { path: string; html: string }[], p: string) => files.find((f) => f.path === p)?.html ?? '';
const visible = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');

describe.each(TEMPLATES)('%s: place on service and Location pages', (template) => {
  it('service page: "<Service> in <City> · <Shop>" and a "Barbershop in <City>" line over the heading', () => {
    const h = at(renderSite(shop({ template }), template), 'services/skin-fade/index.html');
    expect(h).toContain('<title>Skin Fade in Brooklyn, NY · Fresh Cuts</title>');
    expect(h).toContain('<meta property="og:title" content="Skin Fade in Brooklyn, NY · Fresh Cuts">');
    expect(h).toContain('<p class="ab-eyebrow">Barbershop in Brooklyn, NY</p><h1 class="ab-h1">Skin Fade</h1>');
  });
  it('one URL per service: no second, place-named copy of any service page', () => {
    const paths = renderSite(shop({ template }), template).map((f) => f.path);
    expect(paths.filter((p) => p.startsWith('services/'))).toEqual(['services/index.html', 'services/skin-fade/index.html', 'services/beard-trim/index.html', 'services/line-up/index.html']);
    expect(paths.some((p) => /brooklyn/.test(p))).toBe(false);
  });
  it('no area: the title is exactly the old "<Service> · <Shop>" and there is no eyebrow', () => {
    const h = at(renderSite(shop({ template, area: '' }), template), 'services/skin-fade/index.html');
    expect(h).toContain('<title>Skin Fade · Fresh Cuts</title>');
    expect(h).not.toContain('class="ab-eyebrow"');
  });
  it('only the trailing city and state of a street-address area is used', () => {
    const h = at(renderSite(shop({ template, area: '12 Pine St, Williamsburg, Brooklyn, NY' }), template), 'services/skin-fade/index.html');
    expect(h).toContain('<title>Skin Fade in Brooklyn, NY · Fresh Cuts</title>');
    expect(h).toContain('Barbershop in Brooklyn, NY</p>');
    expect(/<title>[^<]*<\/title>/.exec(h)![0]).not.toContain('Pine');
  });
  it('the pgPlace label edits the place everywhere (titles and eyebrow), markers or not', () => {
    const d = shop({ template, labels: { pgPlace: 'Williamsburg, Brooklyn' } });
    const files = renderSite(d, template);
    expect(at(files, 'services/skin-fade/index.html')).toContain('<title>Skin Fade in Williamsburg, Brooklyn · Fresh Cuts</title>');
    expect(at(files, 'services/skin-fade/index.html')).toContain('Barbershop in Williamsburg, Brooklyn</p>');
    expect(at(files, 'location/index.html')).toContain('<title>Barbershop in Williamsburg, Brooklyn · Fresh Cuts</title>');
    const marked = renderSite(shop({ template, labels: { pgPlace: '⁣a⁣Park Slope⁣/⁣' } }), template);
    expect(at(marked, 'services/skin-fade/index.html')).toContain('<title>Skin Fade in Park Slope · Fresh Cuts</title>');
  });
  it('Location page: "<Industry> in <City> · <Shop>"; with no area, the old title', () => {
    expect(at(renderSite(shop({ template }), template), 'location/index.html')).toContain('<title>Barbershop in Brooklyn, NY · Fresh Cuts</title>');
    expect(at(renderSite(shop({ template, area: '' }), template), 'location/index.html')).toContain('<title>Fresh Cuts — barbershop at 1 Main St, Brooklyn, NY 11201</title>');
  });
  it('every file has its own <title>', () => {
    const titles = renderSite(shop({ template }), template).map((f) => /<title>([\s\S]*?)<\/title>/.exec(f.html)?.[1]);
    expect(new Set(titles).size).toBe(titles.length);
  });
  it('a service called {shop} and a place called {link:book} print literally (nothing is expanded)', () => {
    const files = renderSite(shop({ template, services: [svc('{shop}')], labels: { pgPlace: '{link:book}' } }), template);
    const h = at(files, 'services/shop/index.html');
    expect(h).toContain('<title>{shop} in {link:book} · Fresh Cuts</title>');
    expect(h).toContain('<h1 class="ab-h1">{shop}</h1>');
  });
  it('escapes markup in the area, the place label and the service name (titles, meta, body)', () => {
    const payload = '</title><script>alert(1)</script>"&\'';
    for (const d of [shop({ template, area: payload }), shop({ template, labels: { pgPlace: payload } }), shop({ template, services: [svc(payload)] })]) {
      for (const f of renderSite(d, template)) {
        if (f.path === 'index.html') continue;
        expect(f.html, f.path).not.toContain('<script>alert(1)');
        expect(f.html, f.path).not.toContain('</title><script');
        expect(f.html, f.path).not.toMatch(/content="[^"]*"[^>]*"&'/);
      }
    }
    const h = at(renderSite(shop({ template, labels: { pgPlace: payload } }), template), 'services/skin-fade/index.html');
    expect(h).toContain('&lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;&quot;&amp;&#39;');
  });
});

const mk = (n: number): NavItem[] => Array.from({ length: n }, (_, i) => ({ key: 'about', href: `/p${i}/`, label: `P${i}`, active: i === 6, external: false }));
describe('navListHtml: the More menu', () => {
  it('5 items or fewer: no More, markup unchanged', () => {
    const h = navListHtml(mk(5).map((i) => ({ ...i, active: false })), 'Menu');
    expect(h).not.toContain('ab-more');
    expect(h).toBe('<nav class="ab-nav" aria-label="Menu"><input type="checkbox" id="ab-nav-toggle" class="ab-nav-toggle" aria-label="Menu"><label for="ab-nav-toggle" class="ab-burger" aria-hidden="true"><i></i></label><ul class="ab-nav-list">' +
      [0, 1, 2, 3, 4].map((i) => `<li><a href="/p${i}/">P${i}</a></li>`).join('') + '</ul></nav>');
  });
  it('more than 5: the first 5, then the rest flat (phone) and in a <details> More (desktop), links once each per copy', () => {
    const h = navListHtml(mk(8), 'Menu', 'More');
    const lis = (h.match(/<ul class="ab-nav-list">([\s\S]*)<\/ul><\/nav>/) as RegExpMatchArray)[1];
    for (let i = 0; i < 5; i++) expect(lis.indexOf(`href="/p${i}/"`)).toBeGreaterThan(-1);
    expect(h).toContain('<li class="ab-more-flat"><a href="/p5/">P5</a></li>');
    expect(h).toContain('<li class="ab-more"><details class="ab-more-d"><summary');
    expect(h).toContain('>More</summary>');
    for (let i = 5; i < 8; i++) expect(h.split(`href="/p${i}/"`).length - 1).toBe(2);
    for (let i = 0; i < 5; i++) expect(h.split(`href="/p${i}/"`).length - 1).toBe(1);
    // the active item (6) is marked, and so is the More button that holds it
    expect(h).toContain('aria-current="page"');
    expect(h).toMatch(/<summary class="is-active"/);
    // no duplicate ids
    const ids = [...h.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
  });
  it('hrefs and labels are escaped in both copies; the More label is escaped', () => {
    const items = mk(7).map((i, k) => (k === 6 ? { ...i, href: '/x" onclick="1', label: '&lt;b&gt;' } : i));
    const h = navListHtml(items, 'Menu', '&lt;More&gt;');
    expect(h).not.toContain('onclick="1');
    expect(h).toContain('&lt;More&gt;</summary>');
  });
  it.each(TEMPLATES)('%s CSS: phones get the flat list, desktops the dropdown, below the existing 1024px break', (t) => {
    const css = NAV_CSS[t];
    expect(css).toMatch(/\.ab-more\{display:none\}/);
    expect(css).toMatch(/@media\(min-width:1024px\)\{[^@]*\.ab-more-flat\{display:none\}[^@]*\.ab-more\{display:block/);
    expect(css).toContain('.ab-more-list');
    // the phone dropdown does not overflow a 320px screen: it is a right-anchored list of at most 220px min width
    expect(css).toMatch(/\.ab-nav-list\{display:none;[^}]*min-width:220px/);
  });
});

describe.each(TEMPLATES)('%s: the menu on real pages', (template) => {
  const d = shop({ template, about: { heading: 'About', description: ['We cut hair on Main Street.'], imageUrl: '' } });
  it('a shop with more than 5 menu items gets More on Home and on every page, and every menu link is a deployed page', () => {
    const r = renderSiteBundle(d);
    const paths = new Set(r.pages.map((p) => p.path));
    const deployed = (href: string) => ['/book', '/shop'].includes(href) || paths.has(href === '/' ? 'index.html' : `${href.slice(1)}index.html`);
    for (const f of r.pages) {
      expect(f.html, f.path).toContain('class="ab-more"');
      for (const m of f.html.matchAll(/<nav class="ab-nav"[\s\S]*?<\/nav>/g)) {
        for (const a of m[0].matchAll(/href="([^"]+)"/g)) expect(deployed(a[1]), `${f.path} -> ${a[1]}`).toBe(true);
      }
    }
  });
  it('a hidden page is not in the menu, the footer or the More copy', () => {
    const r = renderSiteBundle({ ...d, pages: { order: [], hidden: ['hours'] } });
    for (const f of r.pages) expect(f.html, f.path).not.toContain('href="/hours/"');
  });
});

describe('footer', () => {
  it('without the new fields it is what it was', () => {
    expect(footerHtml('prime', { name: 'A & B', year: 2026 })).toBe('<footer class="ab-foot"><div class="ab-wrap"><div class="ab-foot-name">A &amp; B</div><p class="ab-foot-copy">&copy; 2026 &middot; Built by Prime Barber</p></div></footer>');
  });
  it.each(TEMPLATES)('%s: nested pages print name, address, a tap-to-call phone and a list of every deployed page and service page', (template) => {
    const files = renderSite(shop({ template }), template);
    const h = at(files, 'hours/index.html');
    const foot = /<footer[\s\S]*<\/footer>/.exec(h)![0];
    expect(foot).toContain('Fresh Cuts');
    expect(foot).toContain('1 Main St, Brooklyn, NY 11201');
    expect(foot).toContain('href="tel:(512)555-0100"');
    for (const href of ['/', '/services/', '/services/skin-fade/', '/services/beard-trim/', '/services/line-up/', '/hours/', '/location/', '/contact/']) expect(foot).toContain(`href="${href}"`);
    expect(foot).toContain('>Pages<');
  });
  it('the footer lists only deployed pages and escapes service names and address', () => {
    const files = renderSite(shop({ services: [svc('<b>Fade</b>')], contact: { address: '1 <i>Main</i> St', email: '' }, pages: { order: [], hidden: ['hours'] } }));
    const foot = /<footer[\s\S]*<\/footer>/.exec(at(files, 'contact/index.html'))![0];
    expect(foot).not.toContain('<b>'); expect(foot).not.toContain('<i>');
    expect(foot).not.toContain('href="/hours/"');
    expect(foot).toContain('&lt;b&gt;Fade&lt;/b&gt;');
  });
  it('no phone / no address: those lines are not printed', () => {
    const foot = /<footer[\s\S]*<\/footer>/.exec(at(renderSite(shop({ phone: '', contact: { address: '', email: 'a@b.co' } })), 'hours/index.html'))![0];
    expect(foot).not.toContain('tel:'); expect(foot).not.toContain('ab-foot-addr');
  });
});

describe('back-compat with the pre-change multi-page output', () => {
  const pre = JSON.parse(readFileSync(join(__dirname, 'fixtures/pre-pages-v2-multi.json'), 'utf8')) as Record<string, any>;
  // The changes the plan makes (6d): <title>/og:title (place), <style> (More menu css), the menu (More), the footer.
  const mask = (h: string) => h
    .replace(/<title>[\s\S]*?<\/title>/, '').replace(/<meta property="og:title"[^>]*>/, '')
    .replace(/<style>[\s\S]*?<\/style>/g, '<style/>').replace(/<nav class="ab-nav"[\s\S]*?<\/nav>/, '<nav/>').replace(/<footer[\s\S]*?<\/footer>/, '<footer/>').replace(/<p class="ab-eyebrow">[^<]*<\/p>/, '');
  it.each(TEMPLATES)('%s: same files, same sitemap, same page bodies', (template) => {
    const r = renderSiteBundle({ ...pre.data, template }, { imageUrls: pre.imageUrls, siteBaseUrl: 'https://fresh-cuts.vercel.app' });
    expect(r.pages.map((p) => p.path)).toEqual(pre[template].paths);
    expect(r.sitemap).toBe(pre[template].sitemap);
    for (const p of r.pages) {
      const before = pre[template].html[p.path] as string;
      if (p.path === 'index.html') {
        // Home: only the style block, the menu and the title-ish parts may differ
        expect(mask(p.html).replace(/published-at" content="\d+"/, '')).toBe(mask(before).replace(/published-at" content="\d+"/, ''));
      } else {
        expect(mask(p.html), p.path).toBe(mask(before));
      }
    }
  });
  it('the sitemap holds every file of the set and nothing else', () => {
    const r = renderSiteBundle({ ...pre.data }, { imageUrls: pre.imageUrls, siteBaseUrl: 'https://fresh-cuts.vercel.app' });
    const locs = [...(r.sitemap as string).matchAll(/<loc>https:\/\/fresh-cuts\.vercel\.app([^<]*)<\/loc>/g)].map((m) => m[1]);
    expect(locs).toEqual([...r.set.files.map((f) => f.href), '/book', '/shop'].filter((h) => h !== '/shop' || r.set.shopInternal));
    expect(EXTRA_KEYS.some((k) => locs.includes(`/${k}/`))).toBe(false);
  });
});
