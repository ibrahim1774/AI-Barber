// site.logo { url, w, h }: an <img> replaces the name in the header (alt = the shop name); the footer, <title> and
// SEO keep the name. A site with no logo renders exactly as before this feature.
import { describe, expect, it } from 'vitest';
import { renderSiteBundle, imageUrlMapOf } from '../../lib/render/site';
import { swapImagePlaceholders } from '../../lib/deploySite';
import type { WebsiteData } from '../../types';

const URL_ = 'https://storage.googleapis.com/bkt/ios-drafts/abc-123/logo/1-ab.png';
const svc = (title: string) => ({ title, subtitle: '', description: '', icon: 'scissors' as const, imageUrl: '' });
const site = (template: string, multi: boolean, extra: Record<string, unknown> = {}): WebsiteData => ({
  shopName: 'Fresh Cuts & Co', area: 'Brooklyn, NY', phone: '(512) 555-0100', bookingUrl: '/book', template,
  hero: { heading: 'Hello', tagline: '', imageUrl: '' }, about: { heading: 'About', description: [], imageUrl: '' },
  services: [svc('Skin Fade')], gallery: [], contact: { address: '1 Main St, Brooklyn, NY 11201', email: '' },
  ...(multi ? { pages: { order: [], hidden: [] }, extraPages: { on: ['faq'], serviceGuides: true, seed: 1 } } : {}),
  ...extra,
} as unknown as WebsiteData);
const LOGO = { url: URL_, w: 600, h: 200 };
const render = (d: WebsiteData) => renderSiteBundle(d, { siteBaseUrl: 'https://x.example.com' }).pages;
const header = (html: string) => /<header[\s\S]*?<\/header>/.exec(html)?.[0] ?? '';

describe.each(['luxe', 'prime', 'euphoria'] as const)('%s logo', (t) => {
  for (const multi of [true, false]) {
    it(`${multi ? 'multi-page' : 'single-page'}: the header shows the image, the name stays in title and footer`, () => {
      const pages = render(site(t, multi, { logo: LOGO }));
      const home = pages[0].html;
      const m = /<img[^>]*src="\{\{logo\}\}"[^>]*>/.exec(home)?.[0] ?? '';
      expect(m, 'logo <img> in the home header').not.toBe('');
      expect(m).toContain('alt="Fresh Cuts &amp; Co"');
      expect(m).toMatch(/width="600"/);
      expect(m).toMatch(/height="200"/);
      expect(m).toContain('fetchpriority="high"');
      expect(m).toMatch(/object-fit:contain/);
      expect(m).toMatch(/max-width:min\((60vw,320px|52vw,300px)\)/);
      expect(home).toMatch(/<title>[^<]*Fresh Cuts/);
      expect(home.split('Fresh Cuts').length).toBeGreaterThan(2); // footer + meta still name the shop
      // the name is gone from the header region itself
      const hdr = multi ? header(home) : home.slice(home.indexOf('<body'), home.indexOf('<body') + 3000);
      expect(hdr.replace(/alt="[^"]*"/g, '')).not.toContain('Fresh Cuts');
    });
  }

  it('a nested page shows the same logo and links home', () => {
    const page = render(site(t, true, { logo: LOGO })).find((p) => p.path === 'services/index.html')!;
    expect(page.html).toMatch(/<a class="ab-brand ab-logo" href="\/"[^>]*><img[^>]*src="\{\{logo\}\}"/);
    expect(page.html).toContain('<title>');
  });

  it('the placeholder is filled with the URL (escaped) at deploy', () => {
    const d = site(t, true, { logo: LOGO });
    expect(imageUrlMapOf(d).logo).toBe(URL_);
    const home = render(d)[0].html;
    expect(swapImagePlaceholders(home, { logo: URL_ })).toContain(`src="${URL_}"`);
  });

  it('bad dimensions or a missing URL fall back to the name (never a broken image)', () => {
    for (const logo of [{ url: URL_, w: 'x', h: 5 }, { url: URL_, w: 0, h: 5 }, { url: '', w: 5, h: 5 }, { url: URL_, w: 5 }, null, 'x']) {
      const home = render(site(t, true, { logo }))[0].html;
      expect(home, JSON.stringify(logo)).not.toContain('{{logo}}');
    }
  });

  it('no logo: nothing about the logo is emitted', () => {
    for (const multi of [true, false]) for (const p of render(site(t, multi))) {
      expect(p.html).not.toContain('{{logo}}');
      expect(p.html).not.toContain('ab-logo');
    }
  });
});

describe('the pending shape (what publish stores and the deploy renders)', () => {
  it('url "uploaded" + imageUrls.logo renders the logo; without the map entry the name shows', () => {
    const d = site('prime', true, { logo: { url: 'uploaded', w: 600, h: 200 } });
    const withMap = renderSiteBundle(d, { imageUrls: { logo: URL_ } }).pages[0].html;
    expect(withMap).toContain('src="{{logo}}"');
    const noMap = renderSiteBundle(d, { imageUrls: {} }).pages[0].html;
    expect(noMap).not.toContain('{{logo}}');
    expect(noMap).toContain('Fresh Cuts');
  });
});

describe('logo size per design (logo-only mode)', () => {
  const imgStyle = (t: string, multi: boolean, logo = { url: URL_, w: 600, h: 200 }) =>
    /<img[^>]*src="\{\{logo\}\}"[^>]*style="([^"]*)"/.exec(render(site(t, multi, { logo }))[0].html)?.[1] ?? '';
  const SIZES = { luxe: ['clamp(48px,12.3vw,72px)', 'min(60vw,320px)'], prime: ['clamp(44px,11.3vw,64px)', 'min(52vw,300px)'], euphoria: ['clamp(44px,11.3vw,64px)', 'min(52vw,300px)'] } as const;
  for (const t of ['luxe', 'prime', 'euphoria'] as const) for (const multi of [true, false]) {
    it(`${t} ${multi ? 'multi' : 'single'}: height ${SIZES[t][0]}, max-width ${SIZES[t][1]}`, () => {
      const st = imgStyle(t, multi);
      expect(st).toContain(`height:${SIZES[t][0]}`);
      expect(st).toContain(`max-width:${SIZES[t][1]}`);
      expect(st).toContain('width:auto');
    });
  }
  it('a logo wider than 20:1 still falls back to the name', () => {
    for (const t of ['luxe', 'prime', 'euphoria']) expect(render(site(t, true, { logo: { url: URL_, w: 2100, h: 100 } }))[0].html).not.toContain('{{logo}}');
  });
});
