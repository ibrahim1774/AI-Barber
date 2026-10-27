// P3a (spec 2026-10-23-barber-experience): the label registry, the rating line, hidden reviews and
// the header phone fix, across the three static renderers.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { generateHTMLWithPlaceholders } from '../../lib/render/luxe';
import { generatePrimeHTMLWithPlaceholders } from '../../lib/render/prime';
import { generateEuphoriaHTMLWithPlaceholders } from '../../lib/render/euphoria';
import {
  LABELS, LABEL_KEYS, clampLabel, isFigureFreeLabel, defaultLabel, isLabelKey, isValidRatingLine, ratingLineCustom, ratingLineProblem,
  t, visibleLabelKeys, type LabelKey,
} from '../../lib/render/labels';
import { aggregateToShow, displayPhone, reviewKey, visibleReviews } from '../../lib/render/honest';
import { nicheByKey } from '../../lib/booksyNiche';
import type { TemplateId, WebsiteData } from '../../types';

beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2031-06-01T12:00:00Z')); });
afterAll(() => { vi.useRealTimers(); });

const render: Record<TemplateId, (d: WebsiteData) => string> = {
  luxe: generateHTMLWithPlaceholders,
  prime: generatePrimeHTMLWithPlaceholders,
  euphoria: generateEuphoriaHTMLWithPlaceholders,
};
const TEMPLATES: TemplateId[] = ['luxe', 'prime', 'euphoria'];

// Every section on, so every label has somewhere to appear.
const full = (extra: Partial<WebsiteData> = {}): WebsiteData => ({
  shopName: 'Jacks Barbershop',
  area: 'Austin, TX',
  phone: '(512) 555-0142',
  hero: { heading: 'Sharp cuts', tagline: 'Walk-ins welcome', imageUrl: 'https://x.test/h.jpg' },
  about: { heading: 'About us', description: ['One', 'Two'], imageUrl: 'https://x.test/a.jpg' },
  services: [{ title: 'Cut', subtitle: '', price: '30', description: 'd', icon: 'scissors', imageUrl: '' }],
  gallery: ['u0', 'u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7'],
  contact: { address: '1 Main St, Austin, TX', email: 'hi@example.com' },
  aggregateRating: { rating: 4.8, count: 1200 },
  reviewsSource: 'Booksy',
  reviews: [
    { author: 'Al', comment: 'Great cut', rating: 5, date: 'May' },
    { author: 'Bo', comment: 'Fine work', rating: 4 },
  ],
  hours: [{ day: 'Mon', open: '09:00', close: '17:00' }, { day: 'Sun', open: '', close: '', closed: true }],
  staff: [{ name: 'Sam', role: 'Barber', photo: 'p', bookingUrl: 'https://cal.example.com/sam' }],
  bookingUrl: 'https://booksy.com/x',
  shopUrl: 'https://www.aibarber.org/shop/x',
  policy: { title: 'Note', body: 'Be on time' },
  pullQuote: { text: 'Quote' },
  ...extra,
});
const withTemplate = (template: TemplateId, extra: Partial<WebsiteData> = {}) => full({ template, ...extra });
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

describe('registry', () => {
  it('keeps every key barbers already saved (renaming would drop their text)', () => {
    for (const k of [
      'galleryEyebrow', 'galleryHeading', 'teamEyebrow', 'teamHeading', 'hoursEyebrow', 'hoursHeading',
      'reviewsEyebrow', 'reviewsHeading', 'servicesEyebrow', 'servicesHeading', 'contactHeading',
      'contactLocationLabel', 'contactPhoneLabel', 'mapEyebrow', 'mapHeading', 'bookingNote',
    ]) expect(isLabelKey(k), k).toBe(true);
  });

  it('every label has a title, a positive cap and a default within the cap', () => {
    for (const k of LABEL_KEYS) {
      const def = LABELS[k];
      expect(def.title.length, k).toBeGreaterThan(0);
      expect(def.max, k).toBeGreaterThan(0);
      for (const niche of ['barber', 'nails']) {
        expect(Array.from(defaultLabel(k, nicheByKey(niche), { area: 'Austin, TX', niche })).length, k).toBeLessThanOrEqual(def.max);
      }
    }
  });

  it('only a design\'s own labels are tappable for that design', () => {
    for (const template of TEMPLATES) {
      for (const k of visibleLabelKeys(withTemplate(template))) {
        const own = (LABELS[k] as { template?: TemplateId }).template;
        expect(own === undefined || own === template, `${template}:${k}`).toBe(true);
      }
    }
    expect(visibleLabelKeys(withTemplate('luxe'))).not.toContain('ratingLine');
  });

  it('a section that is not printed has no tappable labels', () => {
    const bare = withTemplate('luxe', { gallery: [], staff: [], hours: [], reviews: [], services: [], shopUrl: '' });
    const keys = visibleLabelKeys(bare);
    for (const k of ['galleryHeading', 'teamHeading', 'hoursHeading', 'reviewsHeading', 'servicesHeading', 'navShop']) {
      expect(keys).not.toContain(k as LabelKey);
    }
    expect(keys).toContain('contactHeading');
  });

  it('every tappable label\'s default text is printed on the page (nothing is wired to the wrong place)', () => {
    const variants: Partial<WebsiteData>[] = [{}, { niche: 'nails' }];
    for (const template of TEMPLATES) {
      for (const extra of variants) {
        const site = withTemplate(template, extra);
        const html = render[template](site);
        for (const k of visibleLabelKeys(site)) {
          const text = esc(defaultLabel(k, nicheByKey(site.niche), site));
          if (text === '') continue; // bookingNote has no default
          expect(html, `${template} ${k} "${text}"`).toContain(text);
        }
      }
    }
  });

  it('a stored label replaces the default on the page', () => {
    for (const template of TEMPLATES) {
      const site = withTemplate(template);
      const keys = visibleLabelKeys(site);
      const labels: Record<string, string> = {};
      for (const k of keys) labels[k] = `ZQ ${k}`;
      const html = render[template]({ ...site, labels });
      for (const k of keys) expect(html, `${template} ${k}`).toContain(`ZQ ${k}`);
    }
  });
});

describe('t()', () => {
  it('escapes every HTML-significant character', () => {
    const out = t({ mapHeading: `<script>alert('x')</script> & "q"` }, 'mapHeading');
    expect(out).toBe('&lt;script&gt;alert(&#39;x&#39;)&lt;/script&gt; &amp; &quot;q&quot;');
    expect(out).not.toContain('<');
  });

  it('truncates a 2,000-character label to its cap', () => {
    const out = t({ mapHeading: 'x'.repeat(2000) }, 'mapHeading');
    expect(out.length).toBe(LABELS.mapHeading.max);
  });

  it('caps by characters, never in the middle of an emoji', () => {
    const out = t({ contactPhoneLabel: '😀'.repeat(LABELS.contactPhoneLabel.max + 50) }, 'contactPhoneLabel');
    expect(Array.from(out).length).toBe(LABELS.contactPhoneLabel.max);
    expect(out).not.toMatch(/[\ud800-\udbff]$/);
  });

  it('caps inside a marker wrapper so the closing marker survives', () => {
    const max = LABELS.mapHeading.max;
    const exact = `⁣a⁣${'y'.repeat(max)}⁣/⁣`;
    expect(t({ mapHeading: exact }, 'mapHeading')).toBe(exact);
    const over = `⁣a⁣${'y'.repeat(max + 40)}⁣/⁣`;
    expect(t({ mapHeading: over }, 'mapHeading')).toBe(`⁣a⁣${'y'.repeat(max)}⁣/⁣`);
    expect(clampLabel(over, max)).toBe(`⁣a⁣${'y'.repeat(max)}⁣/⁣`);
  });

  it('uses the default for an empty, blank or non-string value', () => {
    for (const v of ['', '   ', 5 as unknown as string, null as unknown as string]) {
      expect(t({ mapHeading: v }, 'mapHeading')).toBe('Stop By');
    }
  });

  it('ignores unknown keys and prototype keys', () => {
    expect(t({ nonsense: 'x' } as unknown as WebsiteData['labels'], 'mapHeading')).toBe('Stop By');
    expect(isLabelKey('constructor')).toBe(false);
    expect(isLabelKey('__proto__')).toBe(false);
    expect(t(JSON.parse('{"__proto__":{"mapHeading":"x"}}'), 'mapHeading')).toBe('Stop By');
  });

  it('gives the niche-aware default', () => {
    expect(t({}, 'teamHeading', nicheByKey('barber'))).toBe('Meet Our Barbers');
    expect(t({}, 'teamHeading', nicheByKey('nails'))).toBe('Meet the Team');
  });

  it('XSS: a hostile label never reaches any page as markup', () => {
    const evil = `"><img src=x onerror=alert(1)><script>alert(1)</script>`;
    for (const template of TEMPLATES) {
      const site = withTemplate(template);
      const labels: Record<string, string> = {};
      for (const k of visibleLabelKeys(site)) labels[k] = evil;
      labels.ratingLine = evil;
      const html = render[template]({ ...site, labels });
      expect(html, template).not.toContain('<img src=x');
      expect(html, template).not.toContain('onerror=alert(1)><script>');
      expect(html.match(/alert\(1\)<\/script>/g)).toBeNull();
      expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    }
  });

  it('a hand-edited record with extra keys still renders (unknown keys ignored)', () => {
    const labels = { galleryHeading: 'Mine', aboutEyebrow: 'Old key', bogus: '<b>' } as unknown as WebsiteData['labels'];
    const html = generateHTMLWithPlaceholders({ ...withTemplate('luxe'), labels });
    expect(html).toContain('Mine');
    expect(html).not.toContain('<b>');
  });
});

// Visible text of a rendered page: tags, scripts, styles, comments and the <head> removed.
function visibleText(html: string): string[] {
  const body = html.replace(/<head[\s\S]*?<\/head>/i, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, '');
  return body.split(/<[^>]*>/).map((s) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim()).filter(Boolean);
}

describe('no leftover literals', () => {
  // Text that is data (the fixture's own words), a figure from the data, or fixed by the honest-site
  // rules and deliberately not editable: reviews' provenance, the "no stock photos" claim, the Book and
  // Shop section copy from subpages.ts, the credit line.
  const ALLOWED: RegExp[] = [
    /^(Jacks|Barbershop|Jacks Barbershop)$/,
    /^(Sharp cuts|Walk-ins welcome|About us|One|Two|Cut|d|\$30|Sam|Barber|Note|Be on time|Quote|Al|Bo|May|Great cut|Fine work|Mon|Sun)$/,
    /^"?(Great cut|Fine work)"?$/,
    /^(1 Main St, Austin, TX|hi@example\.com|\(512\) 555-0142|Austin, TX|\+? ?Barbershop in Austin, TX)$/i,
    /^(9:00 AM – 5:00 PM)$/,
    /^Report this site$/,
    /^[★\s]+$/,
    /^[★\s]*4\.8( ·| from| stars across)?( 1,200 reviews)?$/,
    /^(4\.8|1,200|1,200 reviews|from 1,200 reviews|· 1,200 reviews|4\.8 stars across 1,200 reviews|★ 4\.8 · 1,200 reviews)$/,
    /^Reviews from Booksy$/,
    /^Real cuts from inside the shop — no stock photos\.$/,
    /^(Book online|Book|Shop|See all)$/,
    /^Copyright (&copy;|©) \d{4} .*\. \.$/, // the generated copyright part; the credit is the footerCredit label
    /^© \d{4} ·$/,
    /^[A-Z]$/, // review avatar initial
    /^\d{2}$/, // service numbering
    /^Barbershop$/,
  ];
  for (const template of TEMPLATES) {
    it(`${template}: every visible word is a label, data, or deliberately fixed`, () => {
      const site = withTemplate(template);
      const labels: Record<string, string> = {};
      for (const k of visibleLabelKeys(site)) labels[k] = `ZQ ${k}`;
      const html = render[template]({ ...site, labels });
      const leftovers = visibleText(html)
        .map((s) => s.replace(/ZQ \w+/g, '').replace(/\s+/g, ' ').trim())
        .filter(Boolean)
        .filter((s) => !ALLOWED.some((re) => re.test(s)));
      expect(leftovers).toEqual([]);
    });
  }
});

describe('rating line', () => {
  const lineOf = (template: TemplateId, ratingLine: string) =>
    render[template](withTemplate(template, { labels: { ratingLine } }));

  it('a valid wording replaces the standard sentence and the figures come from the data', () => {
    expect(isValidRatingLine('Rated {rating} by {count} clients on {source}')).toBe(true);
    const lux = lineOf('luxe', 'Rated {rating} by {count} clients on {source}');
    expect(lux).toContain('Rated 4.8 by 1,200 clients on Booksy');
    const pr = lineOf('prime', 'Rated {rating} by {count} clients on {source}');
    expect(pr).toContain('Rated 4.8 by 1,200 clients on Booksy');
  });

  it('placeholders may not repeat or sit next to each other (they would make up a figure)', () => {
    const bad = [
      '{count}{count} happy clients', '{rating}{count}', '{count}.{count}', '{rating} / {count}', '{rating} - {count}',
      '{rating} {count}', '{count} and {count} clients', 'Rated {rating}, {rating} stars?', '{source}{source}',
    ];
    for (const v of bad) {
      expect(isValidRatingLine(v), v).toBe(false);
      const site = withTemplate('luxe', { aggregateRating: { rating: 4.8, count: 12 }, labels: { ratingLine: v } });
      expect(ratingLineCustom(site), v).toBeNull();
    }
    expect(isValidRatingLine('{rating} from {count} clients')).toBe(true);
    expect(isValidRatingLine('{count} clients on {source}')).toBe(true);
    const site = withTemplate('luxe', { aggregateRating: { rating: 4.8, count: 12 }, labels: { ratingLine: '{count}{count} happy clients' } });
    expect(render.luxe(site)).not.toContain('1212');
  });

  it('asterisks, numeral glyphs and star compounds are not allowed', () => {
    const bad = ['Rated ***** by clients', '*****', '⁎⁎⁎⁎⁎', '∗∗∗∗∗', '✱✱✱', 'Ⅴ stars from {count}', 'ⅰ client', 'fivestar service', 'five-star', '5star', 'Four stars'];
    for (const v of bad) expect(isValidRatingLine(v), v).toBe(false);
    expect(isValidRatingLine('Loved starting from day one!')).toBe(false); // "one" as a number word stays out
    expect(isValidRatingLine('Someone starred us')).toBe(true);
    expect(isValidRatingLine('Honest, friendly (and fast)!')).toBe(true);
  });

  it('plain words with no figures are allowed', () => {
    expect(isValidRatingLine('Loved by our clients')).toBe(true);
    expect(lineOf('luxe', 'Loved by our clients')).toContain('Loved by our clients');
  });

  it('refuses a figure of any kind outside the placeholders', () => {
    const bad = [
      'Rated 5 stars', 'Over 1000 happy clients', '5/5', '100% happy', '４.９ stars', '٤٫٩', '²', 'Rated ★★★★★', '⭐ loved',
      'Rated five stars', 'Hundreds of happy clients', 'Thousands love us', 'a Dozen reasons', 'Rated TEN out of ten',
      'f​ive stars', 'Rated 4.9 {rating}', '{rating', '{ratings}', '{Rating}', '{rating }', '{{rating}}x}',
      'оne of a kind', // Cyrillic o
      '💯 loved', '', '   ',
    ];
    for (const v of bad) {
      expect(isValidRatingLine(v), JSON.stringify(v)).toBe(false);
      for (const template of ['luxe', 'prime'] as TemplateId[]) {
        const site = withTemplate(template, { labels: { ratingLine: v } });
        expect(ratingLineCustom(site), JSON.stringify(v)).toBeNull();
      }
    }
    expect(ratingLineProblem('Rated 5 stars')).not.toBe('');
    expect(ratingLineProblem('Loved by our clients')).toBe('');
  });

  it('a refused wording renders the standard line', () => {
    const standard = render.luxe(withTemplate('luxe'));
    expect(lineOf('luxe', 'Rated 5 stars')).toBe(standard);
    expect(standard).toContain('from 1,200 reviews');
    const primeStd = render.prime(withTemplate('prime'));
    expect(lineOf('prime', 'Over 1000 clients')).toBe(primeStd);
  });

  it('{count} is never a typed number: it is always aggregateRating.count', () => {
    const site = withTemplate('luxe', { aggregateRating: { rating: 4.5, count: 77 }, labels: { ratingLine: '{count} clients, {rating} average' } });
    expect(ratingLineCustom(site)).toBe('77 clients, 4.5 average');
  });

  it('a source that looks like a placeholder is not expanded a second time', () => {
    const site = withTemplate('luxe', { reviewsSource: '{count}', labels: { ratingLine: 'On {source} from {count} reviews' } });
    expect(ratingLineCustom(site)).toBe('On {count} from 1,200 reviews');
  });

  it('a wording that needs a count the data does not have falls back to the standard line', () => {
    const site = withTemplate('luxe', { aggregateRating: { rating: 4.5, count: 0 }, labels: { ratingLine: '{count} clients' } });
    expect(ratingLineCustom(site)).toBeNull();
    const noSource = withTemplate('luxe', { reviewsSource: '', bookingUrl: '', labels: { ratingLine: 'on {source}' } });
    expect(ratingLineCustom(noSource)).toBeNull();
  });

  it('display.rating hide removes the rating everywhere it is printed', () => {
    for (const template of ['luxe', 'prime'] as TemplateId[]) {
      const shown = render[template](withTemplate(template));
      const hidden = render[template](withTemplate(template, { display: { rating: 'hide' } }));
      expect(shown, template).toContain('4.8');
      // CSS font sizes such as clamp(16px,4.8vw,20px) are not the rating
      expect(hidden.replace(/clamp\([^)]*\)/g, ''), template).not.toContain('4.8');
      expect(hidden, template).not.toContain('1,200');
      // the reviews themselves stay
      expect(hidden, template).toContain('Great cut');
    }
    expect(aggregateToShow({ ...full(), display: { rating: 'hide' } })).toBeNull();
    expect(aggregateToShow({ ...full(), display: { rating: 'show' } })).not.toBeNull();
    // hide also beats a custom wording
    const both = withTemplate('prime', { display: { rating: 'hide' }, labels: { ratingLine: 'Loved by our clients' } });
    expect(render.prime(both)).not.toContain('Loved by our clients');
  });

  it('the app\'s stored data (aggregateRating) is never changed by hide', () => {
    const site = withTemplate('luxe', { display: { rating: 'hide' } });
    render.luxe(site);
    expect(site.aggregateRating).toEqual({ rating: 4.8, count: 1200 });
  });
});

describe('hidden reviews', () => {
  const al = { author: 'Al', comment: 'Great cut', rating: 5 };
  const bo = { author: 'Bo', comment: 'Fine work', rating: 4 };

  it('the key is a stable hash of author + comment, not a position', () => {
    const relabelled = { ...al, rating: 1, date: 'x' };
    expect(reviewKey(al)).toBe(reviewKey(relabelled));
    expect(reviewKey(al)).not.toBe(reviewKey(bo));
    expect(reviewKey({ author: ' al ', comment: 'GREAT CUT ' })).toBe(reviewKey(al));
    expect(reviewKey(al)).toMatch(/^[0-9a-z]+$/);
  });

  it('a hidden review is gone from every design and the others stay, even after a re-import reorders them', () => {
    for (const template of ['luxe', 'prime'] as TemplateId[]) {
      const hiddenReviews = [reviewKey(al)];
      for (const reviews of [[al, bo], [bo, al]]) {
        const html = render[template](withTemplate(template, { reviews, hiddenReviews }));
        expect(html, template).not.toContain('Great cut');
        expect(html, template).toContain('Fine work');
      }
    }
  });

  it('hiding is applied before the cap on shown reviews', () => {
    const many = Array.from({ length: 14 }, (_, i) => ({ author: `A${i}`, comment: `Comment ${i}`, rating: 5 }));
    const hiddenReviews = [reviewKey(many[0]), reviewKey(many[1])];
    const html = render.luxe(withTemplate('luxe', { reviews: many, hiddenReviews }));
    expect(html).not.toContain('Comment 0<');
    expect(html).toContain('Comment 12');
    expect(visibleReviews({ reviews: many, hiddenReviews })).toHaveLength(12);
  });

  it('hiding every review removes the reviews section', () => {
    for (const template of ['luxe', 'prime'] as TemplateId[]) {
      const html = render[template](withTemplate(template, { hiddenReviews: [reviewKey(al), reviewKey(bo)] }));
      expect(html, template).not.toContain('Reviews from Booksy');
      expect(html, template).not.toContain('Great cut');
    }
    expect(visibleLabelKeys(withTemplate('luxe', { hiddenReviews: [reviewKey(al), reviewKey(bo)] }))).not.toContain('reviewsHeading');
  });

  it('junk in hiddenReviews is ignored', () => {
    const html = render.luxe(withTemplate('luxe', { hiddenReviews: [5, null, {}] as unknown as string[] }));
    expect(html).toContain('Great cut');
  });
});

describe('phone number in the header', () => {
  it('displayPhone formats a plain ten-digit number and is idempotent', () => {
    expect(displayPhone('5125550142')).toBe('(512) 555-0142');
    expect(displayPhone('512-555-0142')).toBe('(512) 555-0142');
    expect(displayPhone('512.555.0142')).toBe('(512) 555-0142');
    expect(displayPhone('(512) 555-0142')).toBe('(512) 555-0142');
    expect(displayPhone(displayPhone('512 555 0142'))).toBe('(512) 555-0142');
  });

  it('leaves everything else as typed', () => {
    for (const v of ['call us', '+44 20 7946 0958', '5125550142 ext 2', '555-0100', '1-512-555-0142', '', '12345678901']) {
      expect(displayPhone(v)).toBe(v);
    }
    expect(displayPhone(undefined)).toBe('');
  });

  it('keeps an editor marker wrapper around the formatted number', () => {
    expect(displayPhone('⁣a⁣5125550142⁣/⁣')).toBe('⁣a⁣(512) 555-0142⁣/⁣');
  });

  it('the page prints the number consistently and the tel: link keeps the digits', () => {
    const html = render.luxe(withTemplate('luxe', { phone: '5125550142' }));
    expect(html).toContain('(512) 555-0142');
    expect(html).toContain('href="tel:5125550142"');
  });

  // Widths in CSS px. Luxe is the only design with the number in the header.
  const COMPACT_BELOW = 431;
  const widths = { 320: true, 375: true, 430: true, 431: false, 768: false } as const;
  it('luxe header: the number never wraps, and the compact button applies at 430px and under only', () => {
    const html = render.luxe(withTemplate('luxe', { phone: '(512) 555-0142', shopName: 'The Very Long Barbershop Name Co' }));
    const header = /<header id="header"[\s\S]*?<\/header>/.exec(html)![0];
    const phone = /<span class="ab-call-text[^"]*"[^>]*>[^<]*<\/span>/.exec(header)![0];
    expect(phone).toContain('whitespace-nowrap');
    expect(header).not.toContain('whitespace-normal');
    expect(header).toContain('aria-label="Call (512) 555-0142"');
    // the shop name wraps to at most two lines (never an ellipsis) instead of pushing the number off
    expect(header).toMatch(/class="ab-name [^"]*uppercase min-w-0"/);
    expect(header).not.toMatch(/truncate|name[^>]*whitespace-nowrap/);
    // the whole header row is allowed to shrink and the call link is not
    expect(header).toContain('shrink-0');
    const rule = /@media \(max-width: (\d+)px\) \{ \.ab-call-text \{ display: none; \}/.exec(html);
    expect(rule).not.toBeNull();
    const max = Number(rule![1]);
    expect(max + 1).toBe(COMPACT_BELOW);
    for (const [w, compact] of Object.entries(widths)) expect(Number(w) <= max, `${w}px`).toBe(compact);
  });

  it('luxe: the full number stays in the hero button and the contact section', () => {
    const html = render.luxe(withTemplate('luxe', { phone: '(512) 555-0142' }));
    expect(html).toContain('Call Now: (512) 555-0142');
    expect(html.split('(512) 555-0142').length - 1).toBeGreaterThanOrEqual(3);
  });

  it('prime and euphoria nav: the name wraps to two lines (no ellipsis), the buttons never wrap or shrink', () => {
    for (const template of ['prime', 'euphoria'] as TemplateId[]) {
      const html = render[template](withTemplate(template, { shopName: 'The Very Long Barbershop Name Co' }));
      const nav = /<nav style[\s\S]*?<\/nav>/.exec(html)![0];
      expect(nav, template).toContain('white-space:normal;display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;overflow:hidden;min-width:0;');
      expect(nav, template).not.toContain('text-overflow:ellipsis');
      expect(nav, template).toContain('gap:12px');
      const buttons = nav.match(/<a [^>]*class="(?:p-cta|eu-cta)[^>]*>/g) ?? [];
      expect(buttons.length, template).toBeGreaterThan(0);
      for (const b of buttons) expect(b, template).toContain('flex-shrink:0');
    }
  });
});

describe('legacy and figure-free labels', () => {
  it('a long saved legacy label renders in full (no silent truncation)', () => {
    const note = 'Walk-ins welcome Monday to Friday, appointments get priority on Saturdays. '.repeat(2).trim();
    expect(Array.from(note).length).toBeGreaterThan(140);
    const heading = 'A gallery heading that a barber saved long before there was any limit at all on it';
    expect(Array.from(heading).length).toBeGreaterThan(60);
    expect(t({ bookingNote: note }, 'bookingNote')).toBe(esc(note));
    expect(t({ galleryHeading: heading }, 'galleryHeading')).toBe(esc(heading));
    expect(clampLabel(note, LABELS.bookingNote.max)).toBe(note);
  });

  it('the prime stat-box labels cannot hold a typed figure', () => {
    for (const bad of ['out of 5 (500+ clients)', '5 stars', 'Rated ★★★★★', '100% happy', 'Five stars']) {
      expect(t({ primeStatRating: bad }, 'primeStatRating'), bad).toBe('Rating');
      expect(t({ primeStatReviews: bad }, 'primeStatReviews'), bad).toBe('Reviews');
    }
    expect(t({ primeStatRating: 'Our score' }, 'primeStatRating')).toBe('Our score');
    expect(isFigureFreeLabel('Our score')).toBe(true);
    expect(isFigureFreeLabel('Our 5')).toBe(false);
  });
});

describe('non-own keys', () => {
  it('t() and defaultLabel() return an empty string for a name that is not a label', () => {
    expect(t({}, 'toString' as LabelKey)).toBe('');
    expect(defaultLabel('constructor' as LabelKey)).toBe('');
  });
});
