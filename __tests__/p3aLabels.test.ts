// P3a (spec 2026-10-23-barber-experience): every small label is tap-to-edit through the existing
// marker system; the allow-list is static; rating and review controls.
import { editableDataPaths } from '@/web/lib/render/editPaths';
import { generateContent } from '@/web/services/geminiService';
import { LABELS, LABEL_KEYS, defaultLabel } from '@/web/lib/render/labels';
import { nicheOf } from '@/web/lib/render/honest';
import type { TemplateId, WebsiteData } from '@/web/types';
import {
  LABEL_TEXT_PATHS, buildPreviewHtml, editableTextPaths, getPath, labelKeyOfPath, markData, prepareEditableHtml,
  setPath, textMaxLength, textValue,
} from '@/lib/editable';
import { renderSite, forRender } from '@/lib/render';
import { fieldLabel, savePathValue } from '@/lib/editor';
import { parsePreviewMessage } from '@/lib/previewBridge';

const inputs = {
  shopName: 'Fresh Cuts', area: 'Brooklyn, NY', phone: '5125550142',
  services: [{ title: 'Haircut', price: '$30' }, { title: 'Skin fade' }],
};
const rich = (d: WebsiteData): WebsiteData => ({
  ...d,
  gallery: ['u0', 'u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7'],
  aggregateRating: { rating: 4.8, count: 1200 }, reviewsSource: 'Booksy',
  reviews: [{ author: 'Al', comment: 'Great cut', rating: 5 }, { author: 'Bo', comment: 'Fine work', rating: 4 }],
  hours: [{ day: 'Mon', open: '09:00', close: '17:00' }, { day: 'Sun', open: '', close: '', closed: true }],
  staff: [{ name: 'Sam', role: 'Barber', photo: 'p' }],
  bookingUrl: 'https://booksy.com/x', shopUrl: 'https://www.aibarber.org/shop/x',
  policy: { title: 'Note', body: 'Be on time' }, pullQuote: { text: 'Quote' },
  contact: { address: '1 Main St, Brooklyn, NY', email: 'hi@example.com' },
});
let fixtures: { template: TemplateId; data: WebsiteData }[] = [];
beforeAll(async () => {
  for (const template of ['luxe', 'prime', 'euphoria'] as TemplateId[]) {
    const g = await generateContent({ ...inputs, template });
    fixtures.push({ template, data: rich({ ...g, template }) });
  }
});

const docOf = (d: WebsiteData) => {
  const { marked, ids } = markData(d);
  return prepareEditableHtml(renderSite(forRender(marked)), ids);
};

describe('label paths', () => {
  test('the allow-list is static: one path per tappable LabelKey (none for ratingLine or pgMenu)', () => {
    expect(LABEL_TEXT_PATHS).toEqual(LABEL_KEYS.filter((k) => (LABELS[k] as { tap?: boolean }).tap !== false).map((k) => `labels.${k}`));
    expect(LABEL_TEXT_PATHS).not.toContain('labels.ratingLine');
    expect(LABEL_TEXT_PATHS).not.toContain('labels.pgMenu');
    for (const p of LABEL_TEXT_PATHS) expect(editableDataPaths(fixtures[0].data)).not.toContain(p);
  });

  test('labelKeyOfPath accepts only registry keys', () => {
    expect(labelKeyOfPath('labels.galleryHeading')).toBe('galleryHeading');
    for (const bad of ['labels.nope', 'labels.', 'labels.ratingLine', 'labels.__proto__', 'labels.constructor', 'galleryHeading', 'hero.heading', 'labels.galleryHeading.x']) {
      expect(labelKeyOfPath(bad)).toBeNull();
    }
  });

  test('editableTextPaths adds the labels the design prints, for N labels N paths', () => {
    for (const { template, data } of fixtures) {
      const paths = editableTextPaths(data).filter((p) => p.startsWith('labels.'));
      expect(paths.length).toBeGreaterThan(8);
      for (const p of paths) {
        const key = labelKeyOfPath(p)!;
        const own = (LABELS[key] as { template?: string }).template;
        expect({ template, p, ok: own === undefined || own === template }).toEqual({ template, p, ok: true });
      }
    }
    const prime = fixtures[1].data;
    expect(editableTextPaths(prime)).toContain('labels.primeServicesLead');
    expect(editableTextPaths(prime)).not.toContain('labels.galleryHeading');
  });

  test('a section the page does not print offers no label to tap', () => {
    const luxe = { ...fixtures[0].data, gallery: [], staff: [], hours: [], reviews: [], services: [] };
    const paths = editableTextPaths(luxe);
    for (const k of ['galleryHeading', 'teamHeading', 'hoursHeading', 'reviewsHeading', 'servicesHeading']) {
      expect(paths).not.toContain(`labels.${k}`);
    }
    expect(paths).toContain('labels.contactHeading');
  });

  test('textValue is the stored label, else the design\'s default for this niche', () => {
    const luxe = fixtures[0].data;
    expect(textValue(luxe, 'labels.galleryHeading')).toBe('The Look');
    expect(textValue(setPath(luxe, 'labels.galleryHeading', 'My work'), 'labels.galleryHeading')).toBe('My work');
    expect(textValue(luxe, 'labels.teamHeading')).toBe(defaultLabel('teamHeading', nicheOf(luxe)));
    expect(textValue(luxe, 'hero.heading')).toBe(luxe.hero.heading);
    expect(getPath(luxe, 'labels.galleryHeading')).toBeUndefined(); // defaults are not stored
  });

  test('each label\'s maximum comes from the registry; other fields have none', () => {
    expect(textMaxLength('labels.mapHeading')).toBe(LABELS.mapHeading.max);
    expect(textMaxLength('labels.bookingNote')).toBe(LABELS.bookingNote.max);
    expect(textMaxLength('hero.heading')).toBeUndefined();
  });

  test('fieldLabel names a label by its registry title', () => {
    expect(fieldLabel('labels.galleryHeading')).toBe('Gallery heading');
    expect(fieldLabel('labels.primeNavBook')).toBe('Menu: Book button');
  });
});

describe('marked labels in the preview', () => {
  test('every tappable label is a tap target in its design, with its default text, and no marker survives', () => {
    for (const { template, data } of fixtures) {
      const html = docOf(data);
      for (const path of editableTextPaths(data).filter((p) => p.startsWith('labels.'))) {
        const text = textValue(data, path);
        if (!text) continue; // bookingNote starts empty
        const esc = text.replace(/&/g, '&amp;').replace(/'/g, '&#39;');
        expect({ template, path, found: html.includes(`<span data-edit="${path}">${esc}</span>`) }).toEqual({ template, path, found: true });
      }
      expect(html).not.toContain('⁣');
    }
  });

  test('"Book now" opens its editor: the nav button of Design 2 and 3 is a tap target', () => {
    expect(docOf(fixtures[1].data)).toContain('<span data-edit="labels.primeNavBook">Book Now</span>');
    expect(docOf(fixtures[2].data)).toContain('<span data-edit="labels.euNavBook">Book now</span>');
  });

  test('the preview shows what the published page shows: same text, no editor attributes in published output', () => {
    for (const { data } of fixtures) {
      const published = buildPreviewHtml(data, false);
      expect(published).not.toContain('data-edit');
      // The editor-only "+ Add a service" control is not on the published page.
      const editable = buildPreviewHtml(data, true).replace(/<(div|section) data-ab-editor-only[^>]*>(?:<p[^>]*>[^<]*<\/p>)?<button[^>]*data-ab-add-service[^>]*>[^<]*<\/button><\/\1>/g, '');
      const strip = (h: string) => h.replace(/<span data-edit="[^"]*">/g, '').replace(/<\/span>/g, '').replace(/ data-edit-image="[^"]*"/g, '')
        .replace(/name="published-at" content="\d+"/, '').replace(/<span[^>]*>/g, '');
      // The visible words are the same (spans stripped on both sides, per-publish stamp removed).
      expect(strip(editable).replace(/\s+/g, ' ')).toBe(strip(published).replace(/\s+/g, ' '));
    }
  });

  test('a stored label shows in the preview and the renderers emit no editor attributes', () => {
    const prime = setPath(fixtures[1].data, 'labels.primeNavBook', 'Reserve');
    expect(docOf(prime)).toContain('<span data-edit="labels.primeNavBook">Reserve</span>');
    expect(renderSite(forRender(prime))).not.toContain('data-edit');
  });

  test('an over-long stored label is cut to its maximum before the markers go on', () => {
    const luxe = setPath(fixtures[0].data, 'labels.mapHeading', 'x'.repeat(500));
    const { marked } = markData(luxe);
    const max = LABELS.mapHeading.max;
    expect((marked.labels as Record<string, string>).mapHeading).toBe(`⁣${/⁣([a-z]+)⁣/.exec((marked.labels as Record<string, string>).mapHeading)![1]}⁣${'x'.repeat(max)}⁣/⁣`);
    expect(docOf(luxe)).toContain(`${'x'.repeat(max)}</span>`);
  });

  test('a hostile label is escaped in the preview too', () => {
    const luxe = setPath(fixtures[0].data, 'labels.mapHeading', '<img src=x onerror=alert(1)>');
    const html = docOf(luxe);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});

describe('bridge', () => {
  const msg = (o: unknown) => JSON.stringify(o);
  test('accepts a label path the design prints and rejects any other', () => {
    const { data } = fixtures[0];
    expect(parsePreviewMessage(msg({ type: 'edit', path: 'labels.mapHeading' }), data)).toEqual({ type: 'edit', path: 'labels.mapHeading' });
    for (const path of ['labels.nope', 'labels.ratingLine', 'labels.primeNavBook', 'labels.__proto__', 'labels.', 'labels.mapHeading.x', 'hero.nope']) {
      expect(parsePreviewMessage(msg({ type: 'edit', path }), data)).toBeNull();
    }
  });

  test('N image rectangles become N pills; unknown slots, junk numbers and long lists are dropped', () => {
    const { data } = fixtures[0];
    const rects = [
      { path: 'hero.imageUrl', x: 0, y: 40, w: 390, h: 300 },
      { path: 'gallery.2', x: 10, y: 400, w: 180, h: 160 },
      { path: 'gallery.3', x: 200, y: 400, w: 180, h: 160 },
    ];
    expect(parsePreviewMessage(msg({ type: 'rects', items: rects }), data)).toEqual({ type: 'rects', items: rects });
    const mixed = [...rects, { path: 'gallery.99', x: 0, y: 0, w: 50, h: 50 }, { path: 'hero.imageUrl', x: 'a', y: 0, w: 1, h: 1 }, { path: 'hero.imageUrl', x: 0, y: 0, w: -4, h: 9 }, null, 5];
    expect(parsePreviewMessage(msg({ type: 'rects', items: mixed }), data)).toEqual({ type: 'rects', items: rects });
    expect(parsePreviewMessage(msg({ type: 'rects', items: 'x' }), data)).toBeNull();
    const many = Array.from({ length: 80 }, (_, i) => ({ path: 'gallery.2', x: i, y: i, w: 50, h: 50 }));
    const parsed = parsePreviewMessage(msg({ type: 'rects', items: many }), data);
    expect(parsed && parsed.type === 'rects' && parsed.items.length).toBeLessThanOrEqual(24);
  });

  test('a rectangles message may be longer than the 2,000 characters the others are held to', () => {
    const { data } = fixtures[0];
    const items = Array.from({ length: 20 }, (_, i) => ({ path: 'gallery.2', x: 10.123456789, y: 400 + i, w: 180.123456789, h: 160.123456789 }));
    const raw = msg({ type: 'rects', items });
    expect(raw.length).toBeGreaterThan(1500);
    expect(parsePreviewMessage(raw, data)).not.toBeNull();
    expect(parsePreviewMessage(msg({ type: 'edit', path: 'hero.heading', pad: 'x'.repeat(2100) }), data)).toBeNull();
    expect(parsePreviewMessage(msg({ type: 'rects', items, pad: 'x'.repeat(9000) }), data)).toBeNull();
  });

  test('ready message; scrolling is no longer one', () => {
    expect(parsePreviewMessage(msg({ type: 'ready' }), fixtures[0].data)).toEqual({ type: 'ready' });
    expect(parsePreviewMessage(msg({ type: 'scrolling' }), fixtures[0].data)).toBeNull();
  });
});

describe('saving a label', () => {
  test('stores trimmed text, drops the key when it equals the default or is empty', () => {
    const luxe = fixtures[0].data;
    const a = savePathValue(luxe, 'labels.mapHeading', '  Visit us  ');
    expect((a.labels as Record<string, string>).mapHeading).toBe('Visit us');
    const b = savePathValue(a, 'labels.mapHeading', 'Stop By');
    expect(b.labels && 'mapHeading' in b.labels).toBeFalsy();
    const c = savePathValue(a, 'labels.mapHeading', '   ');
    expect(c.labels && 'mapHeading' in c.labels).toBeFalsy();
  });

  test('caps the text at the label\'s maximum', () => {
    const out = savePathValue(fixtures[0].data, 'labels.mapHeading', 'y'.repeat(300));
    expect((out.labels as Record<string, string>).mapHeading.length).toBe(LABELS.mapHeading.max);
  });

  test('ordinary fields are set as before', () => {
    expect(savePathValue(fixtures[0].data, 'hero.heading', 'New').hero.heading).toBe('New');
  });

  test('a path outside the registry is never written into labels', () => {
    const d = fixtures[0].data;
    expect(savePathValue(d, 'labels.nope', 'x')).toBe(d);
    expect(savePathValue(d, 'labels.__proto__', 'x')).toBe(d);
  });
});

describe('legacy labels and figure-free stat labels (review S3, S5)', () => {
  const prime = () => ({ ...fixtures[0].data, template: 'prime' as const, aggregateRating: { rating: 4.8, count: 500 } });

  test('a 150-character saved booking note shows in full and survives a save', () => {
    const note = 'Walk-ins welcome Monday to Friday. Saturday is appointments only, so please book ahead if you can, and tell us if you need to cancel.';
    expect(note.length).toBeGreaterThan(120);
    expect(note.length).toBeLessThan(200);
    const d = { ...prime(), labels: { bookingNote: note } } as any;
    expect(textValue(d, 'labels.bookingNote')).toBe(note);
    expect((savePathValue(d, 'labels.bookingNote', note).labels as any).bookingNote).toBe(note);
    const heading = 'x'.repeat(100);
    expect((savePathValue(prime(), 'labels.galleryHeading', heading).labels as any).galleryHeading).toBe(heading);
  });

  test('the prime rating and review-count box labels refuse a typed figure', () => {
    const d = prime();
    for (const key of ['primeStatRating', 'primeStatReviews']) {
      expect(savePathValue(d, `labels.${key}`, 'out of 5 (500+ clients)')).toBe(d);
      expect(savePathValue(d, `labels.${key}`, 'Rated *****')).toBe(d);
      expect((savePathValue(d, `labels.${key}`, 'Our score').labels as any)[key]).toBe('Our score');
    }
    const stored = { ...d, labels: { primeStatRating: '500+ clients' } } as any;
    expect(textValue(stored, 'labels.primeStatRating')).toBe('Rating');
  });
});
