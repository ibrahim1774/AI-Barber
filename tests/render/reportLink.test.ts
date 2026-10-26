import { describe, it, expect } from 'vitest';
import { renderSite } from '../../lib/render/site';
import { generateHTMLWithPlaceholders as renderLuxe } from '../../lib/render/luxe';
import { generatePrimeHTMLWithPlaceholders as renderPrime } from '../../lib/render/prime';
import { generateEuphoriaHTMLWithPlaceholders as renderEuphoria } from '../../lib/render/euphoria';
import { finalizePages } from '../../lib/deploySite';
import { reportLinkHtml } from '../../lib/render/shell';
import type { WebsiteData } from '../../types';

const base = (template: string, labels?: Record<string, string>): WebsiteData => ({
  template, shopName: 'Fresh Cuts', area: 'Austin, TX', phone: '555-0100',
  hero: { heading: 'Fresh Cuts', tagline: 'Sharp.', imageUrl: '' },
  about: { heading: 'About', description: ['Barbers.'], imageUrl: '' },
  services: [{ title: 'Fade', subtitle: '', description: '', icon: 'scissors', imageUrl: '', price: '30' }],
  contact: { address: '1 Main St', email: 'a@b.co' },
  gallery: [], craftImages: [], staff: [], ...(labels ? { labels } : {}),
}) as unknown as WebsiteData;

const single: Record<string, (d: WebsiteData) => string> = {
  luxe: (d) => renderLuxe(d), prime: (d) => renderPrime(d), euphoria: (d) => renderEuphoria(d),
};
const REPORT = /href="mailto:support@davoxa\.com\?subject=Report%20([^"]*)"/g;

describe('Report this site link', () => {
  for (const t of Object.keys(single)) {
    it(`${t}: single page and multi-page footers carry it once, after the credit`, () => {
      const one = single[t](base(t));
      expect(one.match(REPORT)).toHaveLength(1);
      expect(one.indexOf('Built by Prime Barber')).toBeLessThan(one.indexOf('Report this site'));
      const pages = renderSite({ ...base(t), pages: { order: [], hidden: [] } } as WebsiteData);
      for (const p of pages) expect(p.html.match(REPORT)).toHaveLength(1);
    });

    it(`${t}: an edited / hostile credit label stays escaped and the report link is intact and separate`, () => {
      const html = single[t](base(t, { footerCredit: '"><script>alert(1)</script>' }));
      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html.match(REPORT)).toHaveLength(1);
      const blank = single[t](base(t, { footerCredit: '' }));
      expect(blank).toContain('Built by Prime Barber');
      expect(blank.match(REPORT)).toHaveLength(1);
    });
  }

  it('the slug is filled in at deploy and URL-encoded, on every page', () => {
    const out = finalizePages([{ path: 'index.html', html: reportLinkHtml() }, { path: 'a/index.html', html: reportLinkHtml() }], {}, 'fade-lab');
    for (const p of out) expect(p.html).toContain('subject=Report%20fade-lab"');
  });
  it('a slug can never break out of the href', () => {
    const out = finalizePages([{ path: 'index.html', html: reportLinkHtml() }], {}, '"><img src=x onerror=1>');
    expect(out[0].html).not.toContain('<img');
    expect(out[0].html).toContain('Report%20%22%3E%3Cimg');
  });
  it('without a slug (preview) the placeholder is left alone', () => {
    expect(finalizePages([{ path: 'index.html', html: reportLinkHtml() }], {})[0].html).toContain('{{siteSlug}}');
  });
});
