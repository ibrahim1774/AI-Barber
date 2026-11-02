// The fixed luxe home header must stay clear of the hero on every screen size. The repo has no browser runner, so this asserts
// the CSS that produces the layout; the pixel check (header vs hero at 16 viewports, Chromium and WebKit) is the scratch
// measure.mjs acceptance run recorded in the commit. Only the luxe home has a fixed header: prime, euphoria and every nested
// page use a sticky one in the page flow and must not carry the block.
import { describe, expect, it } from 'vitest';
import { renderSiteBundle } from '../../lib/render/site';
import { PAIR_CSS } from '../../lib/render/shell';
import type { WebsiteData } from '../../types';

const svc = (title: string) => ({ title, subtitle: '', description: '', icon: 'scissors' as const, imageUrl: '' });
const LOGO = { url: 'https://storage.googleapis.com/bkt/ios-drafts/abc-123/logo/1-ab.png', w: 600, h: 200 };
const site = (template: string, multi: boolean, extra: Record<string, unknown> = {}): WebsiteData => ({
  shopName: 'The Original Downtown Gentlemens Barber Lounge', area: 'Brooklyn, NY', phone: '(512) 555-0142', bookingUrl: '/book', template,
  hero: { heading: 'Hello', tagline: '', imageUrl: '' }, about: { heading: 'About', description: [], imageUrl: '' },
  services: [svc('Skin Fade'), svc('Taper')], gallery: [], contact: { address: '1 Main St, Brooklyn, NY 11201', email: '' },
  ...(multi ? { pages: { order: [], hidden: [] }, extraPages: { on: ['faq'], serviceGuides: true, seed: 1 } } : {}),
  ...extra,
} as unknown as WebsiteData);
const pages = (d: WebsiteData) => renderSiteBundle(d, { siteBaseUrl: 'https://x.example.com' }).pages;
const home = (d: WebsiteData) => pages(d)[0].html;
const HOME_RULE = '#home { height: auto; min-height: 55vh; padding-top: calc(var(--ab-head-pad) + var(--ab-head-row)); }';
const count = (s: string, sub: string) => s.split(sub).length - 1;

describe.each([false, true])('luxe home hero clearance (multi-page: %s)', (multi) => {
  it('carries the block exactly once, with the hero reserving the header height', () => {
    const html = home(site('luxe', multi));
    expect(count(html, 'Fixed header vs hero')).toBe(1);
    expect(count(html, HOME_RULE)).toBe(1);
    expect(html).toContain('#home > .relative { padding-top: 24px; }');
    expect(html).toContain('#header > .container > div:first-child > div:first-child { flex: 1 1 0;');
    expect(html).toMatch(/#header \.ab-call \{[^}]*flex-wrap: wrap;[^}]*overflow: hidden;/);
    expect(html).toMatch(/#header \.ab-name, #header \.ab-brand-name \{ min-width: min\(8ch, 30vw\); \}/);
  });

  it('reserves the name row without a logo', () => {
    expect(home(site('luxe', multi))).toContain(':root { --ab-head-row: var(--ab-row-name); }');
  });

  it('reserves the logo row for headerShow: logo', () => {
    expect(home(site('luxe', multi, { logo: LOGO, headerShow: 'logo' }))).toContain(':root { --ab-head-row: var(--ab-row-logo); }');
  });

  it('reserves the pair row for a valid logo and no headerShow', () => {
    expect(home(site('luxe', multi, { logo: LOGO }))).toContain(':root { --ab-head-row: var(--ab-row-pair); }');
  });

  it('every selector in the block is scoped to #header, #home or :root', () => {
    const html = home(site('luxe', multi));
    const block = html.slice(html.indexOf('/* Fixed header vs hero'), html.indexOf('section.py-12, section.py-16 {'));
    const rules = block.replace(/\/\*[\s\S]*?\*\//g, '').split(/\n/).map((l) => l.trim()).filter(Boolean);
    expect(rules.length).toBe(13);
    for (const r of rules) expect(r, r).toMatch(/^(:root|#header|#home|@media[^{]*\{ (:root|#header))/);
  });

  it('the phone number is never taken out of the markup (only squeezed to its icon by CSS)', () => {
    const html = home(site('luxe', multi));
    expect(html).toContain('href="tel:');
    expect(html).toContain('(512) 555-0142');
  });
});

describe('where the block must not appear', () => {
  it.each(['prime', 'euphoria'] as const)('%s home and nested pages are untouched', (t) => {
    for (const multi of [false, true]) {
      for (const p of pages(site(t, multi))) {
        expect(p.html, `${t} ${p.path}`).not.toContain('--ab-head-row');
        expect(p.html, `${t} ${p.path}`).not.toContain('Fixed header vs hero');
      }
    }
  });

  it('luxe nested pages do not carry the home block', () => {
    for (const p of pages(site('luxe', true, { logo: LOGO })).slice(1)) {
      expect(p.html, p.path).not.toContain('--ab-head-row');
      expect(p.html, p.path).not.toContain('#home {');
    }
  });
});

describe('luxe nested page: logo + long name keeps a readable name column', () => {
  it('PAIR_CSS (luxe) gives the pair name a minimum width and a two-line clamp', () => {
    expect(PAIR_CSS.luxe).toContain('.ab-brand.ab-pair{min-width:calc(36px + min(5ch,16vw))}');
    expect(PAIR_CSS.luxe).toMatch(/\.ab-brand-name\{[^}]*min-width:min\(5ch,16vw\)[^}]*-webkit-line-clamp:2/);
  });

  it('prime and euphoria pair CSS is unchanged (never clipped)', () => {
    for (const t of ['prime', 'euphoria'] as const) {
      expect(PAIR_CSS[t]).not.toMatch(/line-clamp|overflow:\s*hidden|8ch/);
    }
  });

  it('a nested luxe page with a logo prints the clamped pair CSS', () => {
    const p = pages(site('luxe', true, { logo: LOGO })).find((x) => x.path === 'services/index.html')!;
    expect(p.html).toContain(PAIR_CSS.luxe);
  });
});
