// Luxe header on a phone: ONE row. The number sits directly next to the call icon inside the one tel: link (.ab-call), vertically
// centred with the brand and the menu button; nothing is printed under the brand. No stored number = no call link.
// Prime and euphoria have no phone text in the header (their button is a Book link), so they are unchanged.
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

describe('luxe header phone on a phone: one row, number next to the icon', () => {
  for (const [name, get] of CASES) {
    const multi = multiOf(name);
    it(`${name}: the icon and the number are one tel: link, nothing under the brand`, () => {
      const html = get(site('luxe', multi));
      const hdr = headerOf(html);
      const call = /<a [^>]*class="ab-call[^"]*"[^>]*>[\s\S]*?<\/a>/.exec(hdr)?.[0] ?? '';
      expect(call).toContain('<svg');
      expect(call).toMatch(/<span class="ab-call-text[^"]*"[^>]*>\(512\) 555-0100<\/span>/);
      expect(call).toMatch(/href="tel:\(512\)555-0100"/);
      // exactly one tel: link in the header, and the old line under the brand is gone
      expect(hdr.split('href="tel:').length - 1).toBe(1);
      expect(hdr).not.toContain('ab-sub');
      expect(hdr).not.toContain('ab-brandcol');
      expect(html).not.toContain('ab-hdrgap');
      // the number is shown at phone widths: nothing hides .ab-call-text any more
      expect(html).not.toMatch(/\.ab-call-text\s*\{\s*display:\s*none/);
      // and it keeps one line
      expect(html).toMatch(/\.ab-call-text\s*\{[^}]*(white-space:\s*nowrap|font-variant-numeric)/);
      expect(call).toMatch(/whitespace-nowrap|ab-call-text/);
    });

    it(`${name}: no stored number prints no call link`, () => {
      for (const phone of ['', '   ', 'call us']) {
        const hdr = headerOf(get(site('luxe', multi, { phone })));
        expect(hdr).not.toContain('tel:');
        expect(hdr).not.toContain('ab-call');
      }
    });

    it(`${name}: the number is escaped`, () => {
      const hdr = headerOf(get(site('luxe', multi, { phone: '(512) 555-0100 <b>"x"</b>' })));
      expect(hdr).not.toContain('<b>');
    });

    for (const mode of [undefined, 'logo', 'name'] as const) {
      it(`${name}: logo header mode ${mode ?? 'both'} keeps the number next to the icon`, () => {
        const hdr = headerOf(get(site('luxe', multi, { logo: LOGO, ...(mode ? { headerShow: mode } : {}) })));
        expect(hdr).toMatch(/<span class="ab-call-text[^"]*"[^>]*>\(512\) 555-0100<\/span>/);
        expect(hdr.indexOf('<img') === -1).toBe(mode === 'name');
        expect(hdr).not.toContain('ab-sub');
      });
    }

    it(`${name}: phone rules shrink the call group at 430px and 360px`, () => {
      const html = get(site('luxe', multi));
      expect(html).toMatch(/@media\s*\(\s*max-width:\s*430px\s*\)/);
      expect(html).toMatch(/@media\s*\(\s*max-width:\s*360px\s*\)/);
    });
  }

  it('prime and euphoria headers have no phone text, so nothing changes for them', () => {
    for (const t of ['prime', 'euphoria']) for (const multi of [true, false]) {
      const html = pages(site(t, multi)).map((p) => p.html).join('');
      expect(html).not.toContain('class="ab-sub"');
      expect(html).not.toContain('ab-brandcol');
      expect(html).not.toContain('ab-call');
    }
  });
});

// #273 added hero padding for the second header line. The header is one row again, so the hero is as it was before.
describe('luxe hero needs no extra padding for the header', () => {
  const home = (d: WebsiteData) => pages(d)[0].html;
  it('no hero gap rule or classes, with or without a number', () => {
    for (const phone of ['(512) 555-0100', '']) {
      const html = home(site('luxe', false, { phone }));
      expect(html).not.toContain('ab-hdrgap');
    }
  });
});
