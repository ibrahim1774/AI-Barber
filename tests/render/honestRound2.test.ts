// Honest sites — re-review fix round 2 (server-rereview-1.md).
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateHTMLWithPlaceholders } from '../../lib/render/luxe';
import { generatePrimeHTMLWithPlaceholders } from '../../lib/render/prime';
import { generateEuphoriaHTMLWithPlaceholders } from '../../lib/render/euphoria';
import { withoutLegacyCopy } from '../../lib/render/honest';
import { swapImagePlaceholders } from '../../lib/deploySite';
import type { WebsiteData } from '../../types';

const read = (p: string) => readFileSync(join(__dirname, '..', '..', p), 'utf8');

const renderers: Record<string, (d: WebsiteData) => string> = {
  luxe: generateHTMLWithPlaceholders,
  prime: generatePrimeHTMLWithPlaceholders,
  euphoria: generateEuphoriaHTMLWithPlaceholders,
};

const LUXE_DEFAULTS: [string, string, string][] = [
  ['Classic Haircut', 'Cut, washed, styled', 'A clean, considered cut tailored to how you actually wear your hair.'],
  ['Beard Trim & Styling', 'Shaped and finished', 'Defined lines, blended length, and a finish that holds between visits.'],
  ['Hot Towel Shave', 'Straight razor, classic finish', 'A traditional straight-razor shave with warm towels and a clean, close finish.'],
  ['Skin Fade', 'Sharp, blended, exact', 'Precise tapering from skin upward, blended for a clean, modern shape.'],
  ['Hair & Scalp Treatment', 'Cleanse and condition', 'A thorough cleanse and conditioning treatment to reset the scalp.'],
];

const site = (extra: Partial<WebsiteData> = {}): WebsiteData => ({
  shopName: 'Kings Cuts',
  area: 'Austin, TX',
  phone: '(512) 555-0100',
  hero: { heading: 'Kings Cuts', tagline: 'Book your next visit.', imageUrl: '' },
  about: { heading: 'About', description: ['Kings Cuts is a barbershop in Austin, TX.'], imageUrl: '' },
  services: LUXE_DEFAULTS.map(([title, subtitle, description]) => ({ title, subtitle, description, icon: 'scissors' as const, imageUrl: '' })),
  gallery: [],
  contact: { address: 'Austin, TX', email: '' },
  ...extra,
});

describe('R1: the default menu is hidden only when nothing in it was touched', () => {
  it('untouched (original subtitles, or none as on old Google imports) → hidden', () => {
    expect(withoutLegacyCopy(site()).services).toEqual([]);
    const gbp = site();
    gbp.services = gbp.services.map((s) => ({ ...s, subtitle: '' }));
    expect(withoutLegacyCopy(gbp).services).toEqual([]);
  });

  it('a barber price on one row → the whole menu is kept, prices included', () => {
    const priced = site();
    priced.services[0] = { ...priced.services[0], price: '$30' };
    const v = withoutLegacyCopy(priced);
    expect(v.services).toHaveLength(5);
    expect(v.services[0].price).toBe('$30');
    for (const [n, render] of Object.entries(renderers)) {
      const html = render(priced);
      expect(html, n).toContain('Classic Haircut');
      expect(html, n).toContain('$30');
    }
  });

  it('a duration or an edited subtitle → kept', () => {
    const dur = site();
    dur.services[2] = { ...dur.services[2], duration: '30 min' };
    expect(withoutLegacyCopy(dur).services).toHaveLength(5);
    const sub = site();
    sub.services[1] = { ...sub.services[1], subtitle: 'Our signature beard work' };
    expect(withoutLegacyCopy(sub).services).toHaveLength(5);
  });

  it('a subtitle from the other default set does not count as original', () => {
    const mixed = site();
    mixed.services[0] = { ...mixed.services[0], subtitle: 'Cut, washed, finished' };
    expect(withoutLegacyCopy(mixed).services).toHaveLength(5);
  });
});

describe('deploySite: image URLs are escaped into src', () => {
  it('a quote cannot break out of the attribute', () => {
    const out = swapImagePlaceholders('<img src="{{hero}}">', { hero: 'https://x.test/a.jpg" onerror="alert(1)' });
    expect(out).toBe('<img src="https://x.test/a.jpg&quot; onerror=&quot;alert(1)">');
  });

  it('"$&" and friends are inserted literally, and & is entity-encoded', () => {
    const out = swapImagePlaceholders('<img src="{{gallery2}}"><img src="{{gallery2}}">', { gallery2: 'https://x.test/a.jpg?w=1&$&=2' });
    expect(out).toBe('<img src="https://x.test/a.jpg?w=1&amp;$&amp;=2"><img src="https://x.test/a.jpg?w=1&amp;$&amp;=2">');
  });

  it('ordinary URLs are unchanged apart from &', () => {
    expect(swapImagePlaceholders('<img src="{{about}}">', { about: 'https://storage.googleapis.com/b/about.jpg' }))
      .toBe('<img src="https://storage.googleapis.com/b/about.jpg">');
  });

  it('deployRenderedSite uses it', () => {
    expect(read('lib/deploySite.ts')).toContain('swapImagePlaceholders(html, imageUrlMap)');
  });
});

describe.each(Object.keys(renderers))('%s: a phone with no digits gets no tel: link', (name) => {
  it('"call us" → no tel:', () => {
    const html = renderers[name](site({ services: [], phone: 'call us' }));
    expect(html).not.toContain('href="tel:');
  });
  it('a real phone still links', () => {
    expect(renderers[name](site({ services: [] }))).toContain('href="tel:');
  });
});

describe('Luxe editor shows prices through displayPrice', () => {
  it('GeneratedWebsite', () => {
    expect(read('components/GeneratedWebsite.tsx')).toContain("service.price ? displayPrice(service.price) : 'Add price'");
  });
});
