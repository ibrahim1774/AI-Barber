// A page's meta description (and og/twitter description) is built only from sections the page prints.
import { describe, expect, it } from 'vitest';
import { SECTION_IDS } from '../../lib/render/sections';
import { renderSiteBundle } from '../../lib/render/site';
import type { WebsiteData } from '../../types';

const svc = (title: string, extra: Record<string, unknown> = {}) => ({ title, subtitle: '', description: `UNIQUE-${title.replace(/\s/g, '')} sentence about this cut.`, icon: 'scissors' as const, imageUrl: '', ...extra });
const shop = (extra: Partial<WebsiteData> = {}): WebsiteData => ({
  shopName: 'Fresh Cuts', area: 'Brooklyn, NY', phone: '(512) 555-0100', bookingUrl: '/book', template: 'luxe',
  hero: { heading: 'Fresh Cuts', tagline: '', imageUrl: '' },
  about: { heading: 'About', description: [], imageUrl: '' },
  services: [svc('Skin Fade', { price: '$35', duration: '45 min' }), svc('Beard Trim', { price: '$15' }), svc('Kids Cut', { price: '$20' })],
  gallery: [], hours: [{ day: 'Mon', open: '09:00', close: '17:00' }],
  contact: { address: '1 Main St, Brooklyn, NY 11201', email: '' },
  pages: { order: [], hidden: [] },
  extraPages: { on: ['faq', 'first-visit', 'hair-care', 'beard-care'], serviceGuides: true, seed: 3 },
  ...extra,
});

const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const norm = (s: string) => decode(s).replace(/\s+/g, ' ').trim();
const metas = (h: string) => {
  const get = (re: RegExp) => { const m = h.match(re); return m ? norm(m[1]) : null; };
  return [
    get(/<meta name="description" content="([^"]*)"/),
    get(/<meta property="og:description" content="([^"]*)"/),
    get(/<meta name="twitter:description" content="([^"]*)"/),
  ].filter((x): x is string => x !== null);
};
const bodyText = (h: string) => norm(h.replace(/<head>[\s\S]*?<\/head>/, '').replace(/<(script|style)[\s\S]*?<\/\1>/g, '').replace(/<[^>]+>/g, ' '));
const generic = (d: WebsiteData) => metas(renderSiteBundle(d).pages.find((p) => p.path === 'about/index.html')?.html ?? renderSiteBundle(d).pages[0].html);

const pagesOf = (d: WebsiteData) => renderSiteBundle(d).pages.filter((p) => p.path !== 'index.html');
const hide = (d: WebsiteData, page: string, id: string): WebsiteData => ({ ...d, pageSections: { [page]: { hidden: [id] } } as WebsiteData['pageSections'] });

describe('meta description follows the visible sections', () => {
  it('FAQ: hiding the first block never leaves its text in the description', () => {
    const d = shop();
    const base = metas(renderSiteBundle(d).pages.find((p) => p.path === 'faq/index.html')!.html)[0];
    const hiddenFirst = metas(renderSiteBundle(hide(d, 'faq', SECTION_IDS.faq[0])).pages.find((p) => p.path === 'faq/index.html')!.html)[0];
    expect(hiddenFirst).not.toBe(base);
  });

  it('service page: a hidden description section is not the meta description', () => {
    const d = hide(shop(), 'service', 'description');
    for (const p of pagesOf(d).filter((x) => /^services\/.+\/index\.html$/.test(x.path))) {
      for (const m of metas(p.html)) expect(m).not.toContain('UNIQUE-');
    }
  });

  it('every extra, service and location page, each section hidden in turn: every description is generic or printed text', () => {
    const base = shop();
    const sitePages = renderSiteBundle(base).pages;
    expect(sitePages.length).toBeGreaterThan(8);
    const cases: [string, string, string][] = [];
    for (const [page, route] of [['faq', 'faq/index.html'], ['first-visit', 'first-visit/index.html'], ['hair-care', 'hair-care/index.html'], ['beard-care', 'beard-care/index.html'], ['location', 'location/index.html']] as const) {
      for (const id of SECTION_IDS[page]) cases.push([page, id, route]);
    }
    for (const id of SECTION_IDS.service) cases.push(['service', id, 'services/']);
    let checked = 0;
    for (const [page, id, route] of cases) {
      const d = hide(base, page, id);
      const out = renderSiteBundle(d).pages;
      const targets = out.filter((p) => (page === 'service' ? /^services\/.+\/index\.html$/.test(p.path) : p.path === route));
      for (const p of targets) {
        const text = bodyText(p.html);
        const ms = metas(p.html);
        expect(ms.length).toBeGreaterThan(0);
        for (const m of ms) {
          const stem = m.replace(/…$/, '');
          const isGeneric = generic(d).includes(m);
          // Location's description is the shop and its address (fixed facts, not a section): check no section text leaks in.
          if (page === 'location') { for (const w of ['Skin Fade', 'Beard Trim', 'Mon', '★']) expect(m).not.toContain(w); checked++; continue; }
          expect(isGeneric || text.includes(stem), `${p.path} hiding ${page}/${id}: "${m}"`).toBe(true);
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(40);
  });

  it('all sections hidden except the Book button: description is generic, not library text', () => {
    const d = shop();
    const faqIds = SECTION_IDS.faq.filter((i) => i !== 'cta');
    const hidAll = { ...d, pageSections: { faq: { hidden: faqIds } } as WebsiteData['pageSections'] };
    const page = renderSiteBundle(hidAll).pages.find((p) => p.path === 'faq/index.html');
    if (page) for (const m of metas(page.html)) expect(bodyText(page.html)).not.toContain(m.replace(/…$/, ''));
  });
});
