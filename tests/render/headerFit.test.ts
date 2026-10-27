// The header never cuts the shop name with "...": it wraps to at most two lines on a fluid font size, in every design,
// on a home page with a menu, a nested page and a single-page home. The repo has no browser runner (no Playwright), so
// this asserts the CSS and markup that produce the layout; the 34-character name is the stress case at 320/375/430.
import { describe, expect, it } from 'vitest';
import { renderSiteBundle } from '../../lib/render/site';
import type { WebsiteData } from '../../types';

const NAME = 'The Original Gentlemens Barber Club'; // 34 characters
const svc = (title: string) => ({ title, subtitle: '', description: '', icon: 'scissors' as const, imageUrl: '' });
const base = (template: string, multi: boolean): WebsiteData => ({
  shopName: NAME, area: 'Brooklyn, NY', phone: '(512) 555-0100', bookingUrl: '/book', template,
  hero: { heading: 'Hello', tagline: '', imageUrl: '' },
  about: { heading: 'About', description: [], imageUrl: '' },
  services: [svc('Skin Fade'), svc('Taper')], gallery: [],
  contact: { address: '1 Main St, Brooklyn, NY 11201', email: '' },
  ...(multi ? { pages: { order: [], hidden: [] }, extraPages: { on: ['faq'], serviceGuides: true, seed: 1 } } : {}),
} as unknown as WebsiteData);

const pagesOf = (template: string, multi: boolean) => renderSiteBundle(base(template, multi), { siteBaseUrl: 'https://x.example.com' }).pages;
// The rule for `.ab-brand` (a nested page / a home with a menu), or the inline style of the single-page header name.
const brandRule = (html: string): string => /\.ab-brand\{[^}]*\}/.exec(html)?.[0] ?? '';
const NAME_FIT = [/white-space:normal/, /overflow-wrap:anywhere/, /line-height:1\.1/, /-webkit-line-clamp:2/, /font-size:clamp\(/];

describe.each(['luxe', 'prime', 'euphoria'] as const)('%s header fit', (t) => {
  it('nested page: .ab-brand wraps to two lines, fluid size, no ellipsis or nowrap', () => {
    const html = pagesOf(t, true).find((p) => p.path === 'services/index.html')!.html;
    const rule = brandRule(html);
    expect(rule).not.toBe('');
    for (const re of NAME_FIT) expect(rule, String(re)).toMatch(re);
    expect(rule).not.toMatch(/text-overflow|nowrap/);
    expect(rule).toMatch(t === 'luxe' ? /font-size:clamp\(14px,4\.4vw,18px\)/ : /font-size:clamp\(16px,4\.8vw,20px\)/);
    expect(html).toContain(NAME.split(' ')[0]);
  });

  it('home with a menu (multi-page): the name is not truncated', () => {
    const home = pagesOf(t, true)[0].html;
    if (t === 'luxe') {
      // luxe's home has its own inline header; the name span carries the fit class instead of truncate/nowrap
      const span = /<span[^>]*ab-name[^>]*>/.exec(home)?.[0] ?? '';
      expect(span).not.toBe('');
      expect(span).not.toMatch(/truncate|whitespace-nowrap/);
    } else {
      for (const re of NAME_FIT) expect(brandRule(home), String(re)).toMatch(re);
    }
    expect(home).not.toMatch(/class="[^"]*\btruncate\b[^"]*"/);
  });

  it('single-page home (no menu): the header name is not truncated', () => {
    const home = pagesOf(t, false)[0].html;
    const head = home.slice(home.indexOf('<body'), home.indexOf('<body') + 6000);
    expect(head).not.toMatch(/text-overflow:ellipsis/);
    if (t === 'luxe') {
      const span = /<span[^>]*ab-name[^>]*>/.exec(home)?.[0] ?? '';
      expect(span).not.toMatch(/truncate|whitespace-nowrap/);
      expect(home).toMatch(/\.ab-name\s*\{[^}]*-webkit-line-clamp:\s*2/);
    } else {
      const a = /<a href="#top"[^>]*>/.exec(home)?.[0] ?? '';
      expect(a).toMatch(/-webkit-line-clamp:2/);
      expect(a).toMatch(/white-space:normal/);
      expect(a).toMatch(/font-size:clamp\(16px,4\.8vw,20px\)/);
      expect(a).not.toMatch(/nowrap|text-overflow/);
    }
  });
});

describe('luxe phone at 430px and under', () => {
  it('shows only the phone icon; the tel link and its aria-label stay (nested page and home)', () => {
    for (const multi of [true, false]) {
      for (const page of pagesOf('luxe', multi).slice(0, multi ? 3 : 1)) {
        expect(page.html, page.path).toMatch(/@media\s*\(\s*max-width:\s*430px\s*\)\s*\{[^}]*\.ab-call-text\s*\{\s*display:\s*none/);
        expect(page.html).not.toMatch(/max-width:\s*379px/);
        expect(page.html).toMatch(/href="tel:[^"]+"/);
        expect(page.html).toMatch(/aria-label="Call [^"]+"/);
        expect(page.html).toContain('ab-call-text');
      }
    }
  });
});
