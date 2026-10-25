import { describe, it, expect } from 'vitest';
import { renderSite } from '../../lib/render/site';
import { generateHTMLWithPlaceholders as renderLuxe } from '../../lib/render/luxe';
import { generatePrimeHTMLWithPlaceholders as renderPrime } from '../../lib/render/prime';
import { generateEuphoriaHTMLWithPlaceholders as renderEuphoria } from '../../lib/render/euphoria';
import { visibleLabelKeys, visiblePageLabelKeys, LABEL_KEYS } from '../../lib/render/labels';
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
const footerOf = (html: string) => html.slice(html.search(/Copyright|&copy;|©/));

describe('footerCredit label', () => {
  it('is a registered, tappable label in every design (single page and multi-page)', () => {
    expect(LABEL_KEYS).toContain('footerCredit' as never);
    for (const t of Object.keys(single)) {
      expect(visibleLabelKeys(base(t))).toContain('footerCredit');
      expect(visiblePageLabelKeys({ ...base(t), pages: { order: [], hidden: [] } } as WebsiteData, 'about')).toContain('footerCredit');
    }
  });
  for (const t of Object.keys(single)) {
    it(`${t}: single page prints the override, falls back when blank, escapes markup`, () => {
      expect(footerOf(single[t](base(t, { footerCredit: 'Built with care' })))).toContain('Built with care');
      expect(single[t](base(t, { footerCredit: '' }))).toContain('Built by Prime Barber');
      const esc = single[t](base(t, { footerCredit: '<b>x</b>' }));
      expect(esc).toContain('&lt;b&gt;x&lt;/b&gt;');
      expect(esc).not.toContain('<b>x</b>');
    });
    it(`${t}: multi-page footer prints the override, falls back when blank, escapes markup`, () => {
      const render = (labels: Record<string, string>) => renderSite({ ...base(t, labels), pages: { order: [], hidden: [] } } as WebsiteData).map((p) => p.html).join('\n');
      expect(render({ footerCredit: 'Built with care' })).toContain('Built with care');
      expect(render({ footerCredit: '' })).toContain('Built by Prime Barber');
      const esc = render({ footerCredit: '<b>x</b>' });
      expect(esc).toContain('&lt;b&gt;x&lt;/b&gt;');
      expect(esc).not.toContain('<b>x</b>');
    });
  }
});
