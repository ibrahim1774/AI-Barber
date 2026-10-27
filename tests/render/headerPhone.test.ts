// Luxe header on a phone: the number prints as small secondary text under the brand (the call icon stays), as its own tel: link.
// No stored number = no line. Prime and euphoria have no phone text in the header (their button is a Book link), so they are unchanged.
import { describe, expect, it } from 'vitest';
import { renderSiteBundle } from '../../lib/render/site';
import type { WebsiteData } from '../../types';

const svc = (title: string) => ({ title, subtitle: '', description: '', icon: 'scissors' as const, imageUrl: '' });
const site = (template: string, multi: boolean, extra: Record<string, unknown> = {}): WebsiteData => ({
  shopName: 'Jax Barber Shop', area: 'Brooklyn, NY', phone: '(512) 555-0100', bookingUrl: '/book', template,
  hero: { heading: 'Hello', tagline: '', imageUrl: '' }, about: { heading: 'About', description: [], imageUrl: '' },
  services: [svc('Skin Fade')], gallery: [], contact: { address: '1 Main St, Brooklyn, NY 11201', email: '' },
  ...(multi ? { pages: { order: [], hidden: [] }, extraPages: { on: ['faq'], serviceGuides: true, seed: 1 } } : {}),
  ...extra,
} as unknown as WebsiteData);
const pages = (d: WebsiteData) => renderSiteBundle(d, { siteBaseUrl: 'https://x.example.com' }).pages;
const headerOf = (html: string) => {
  const shared = /<header class="ab-head"[\s\S]*?<\/header>/.exec(html);
  if (shared) return shared[0];
  const i = html.indexOf('<header id="header"');
  return html.slice(i, html.indexOf('</header>', i));
};
const LOGO = { url: 'https://storage.googleapis.com/bkt/ios-drafts/abc-123/logo/1-ab.png', w: 600, h: 80 };
// where each luxe header lives: multi-page nested page (shared header), multi-page home and single-page home (inline header)
const CASES: [string, (d: WebsiteData) => string][] = [
  ['multi-page nested page', (d) => pages(d).find((p) => p.path === 'services/index.html')!.html],
  ['multi-page home', (d) => pages(d)[0].html],
  ['single-page home', (d) => pages(d)[0].html],
];
const multiOf = (n: string) => n.startsWith('multi');

describe('luxe header phone text on a phone', () => {
  for (const [name, get] of CASES) {
    const multi = multiOf(name);
    it(`${name}: the number is a tel: link right under the brand, the icon call link stays`, () => {
      const hdr = headerOf(get(site('luxe', multi)));
      expect(hdr).toContain('<div class="ab-brandcol">');
      const col = /<div class="ab-brandcol">([\s\S]*?<a class="ab-sub"[^>]*>[^<]*<\/a>)<\/div>/.exec(hdr)?.[1] ?? '';
      expect(col).not.toBe('');
      expect(col).toMatch(/<a class="ab-sub" href="tel:\(512\)555-0100">\(512\) 555-0100<\/a>$/);
      // the brand is inside the same column, before the number, and the call icon link is outside it
      expect(col.indexOf('Jax')).toBeGreaterThan(-1);
      expect(col.indexOf('Jax')).toBeLessThan(col.indexOf('class="ab-sub"'));
      expect(col).not.toContain('class="ab-call');
      expect(hdr).toMatch(/class="ab-call[ "]/);
      expect(hdr.split('href="tel:').length - 1).toBe(2);
      // phone-only: hidden above 430px (where the call link prints the number itself), 44px tap area by padding
      expect(hdr).toMatch(/\.ab-brandcol>\.ab-sub\{display:none;[^}]*font-size:12px;[^}]*font-variant-numeric:tabular-nums[^}]*padding:15px 0/);
      expect(hdr).toMatch(/@media\(max-width:430px\)\{\.ab-brandcol>\.ab-sub\{display:block\}\}/);
    });

    it(`${name}: no stored number prints no line and no extra markup`, () => {
      for (const phone of ['', '   ', 'call us']) {
        const hdr = headerOf(get(site('luxe', multi, { phone })));
        expect(hdr).not.toContain('class="ab-sub"');
        expect(hdr).not.toContain('ab-brandcol');
        expect(hdr).not.toContain('tel:');
      }
    });

    it(`${name}: the number is escaped`, () => {
      const hdr = headerOf(get(site('luxe', multi, { phone: '(512) 555-0100 <b>"x"</b>' })));
      expect(hdr).not.toContain('<b>');
      expect(hdr).toMatch(/<a class="ab-sub" href="tel:[^"<>]*">[^<]*&lt;b&gt;[^<]*<\/a>/);
    });

    for (const mode of [undefined, 'logo', 'name'] as const) {
      it(`${name}: logo header mode ${mode ?? 'both'} keeps the number under the brand`, () => {
        const hdr = headerOf(get(site('luxe', multi, { logo: LOGO, ...(mode ? { headerShow: mode } : {}) })));
        expect(hdr).toMatch(/<div class="ab-brandcol[ "]/);
        expect(hdr).toContain('<a class="ab-sub" href="tel:(512)555-0100">(512) 555-0100</a>');
        expect(hdr.indexOf('<img') === -1).toBe(mode === 'name');
        expect(hdr.indexOf('class="ab-sub"')).toBeGreaterThan(hdr.indexOf(mode === 'name' ? 'Jax' : '<img'));
      });
    }
  }

  it('prime and euphoria headers have no phone text, so nothing changes for them', () => {
    for (const t of ['prime', 'euphoria']) for (const multi of [true, false]) {
      const html = pages(site(t, multi)).map((p) => p.html).join('');
      expect(html).not.toContain('class="ab-sub"');
      expect(html).not.toContain('ab-brandcol');
    }
  });
});
