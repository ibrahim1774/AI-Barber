import { generateContent } from '@/web/services/geminiService';
import { DEFAULT_POLICY, DEFAULT_PULLQUOTE } from '@/web/lib/render/prime';
import type { TemplateId, WebsiteData } from '@/web/types';
import { toShopSite } from '@/lib/importer';
import { renderSite, forRender } from '@/lib/render';
import {
  EDITABLE_TEXT_PATHS,
  SHEET_ONLY_PATHS,
  IMAGE_PATHS,
  EDITOR_JS,
  buildPreviewHtml,
  editableTextPaths,
  getPath,
  isSheetOnly,
  markData,
  prepareEditableHtml,
  setPath,
  stripMarkers,
  tagImageSlots,
} from '@/lib/editable';

const booksy = require('./fixtures/scrape-booksy.json');
const MARK = '\u2063';

const inputs = { shopName: 'Fresh Cuts', area: 'Brooklyn, NY', phone: '555-0100' };

type Fixture = { name: string; data: WebsiteData };
let cached: Promise<Fixture[]> | null = null;
const fixtures = () => (cached ??= buildFixtures());

async function buildFixtures(): Promise<Fixture[]> {
  const luxe = await generateContent({ ...inputs, template: 'luxe' });
  const primeBase = await generateContent({ ...inputs, template: 'prime' });
  // Prime sites carry their own policy / pull-quote once edited; seed them so
  // the prime-only paths are exercised (generateContent leaves them unset).
  const prime: WebsiteData = {
    ...primeBase,
    template: 'prime',
    bookingUrl: 'https://booksy.com/en-us/x',
    policy: { ...DEFAULT_POLICY },
    pullQuote: { ...DEFAULT_PULLQUOTE },
  };
  const euphoria = await generateContent({ ...inputs, template: 'euphoria' });
  const scraped = toShopSite(booksy, 'https://booksy.com/en-us/dl/show-business/998736', 'booking').site;
  return [
    { name: 'luxe (generateContent)', data: { ...luxe, template: 'luxe' } },
    { name: 'prime (generateContent + policy/pullQuote)', data: prime },
    { name: 'euphoria (generateContent)', data: { ...euphoria, template: 'euphoria' } },
    { name: 'luxe (booksy scrape)', data: { ...scraped, template: 'luxe' } },
    { name: 'prime (booksy scrape)', data: { ...scraped, template: 'prime' } },
    { name: 'euphoria (booksy scrape)', data: { ...scraped, template: 'euphoria' } },
  ];
}

function nonEmpty(v: unknown): boolean {
  return typeof v === 'string' && v.trim().length > 0;
}

/** The marked + prepared preview document (no images needed for text reachability). */
function editableDoc(d: WebsiteData): string {
  const { marked, ids } = markData(d);
  return prepareEditableHtml(renderSite(forRender(marked)), ids);
}

describe('editable paths', () => {
  test('prime fixture really carries policy and pullQuote', async () => {
    const prime = (await fixtures())[1].data;
    expect(prime.template).toBe('prime');
    expect(nonEmpty(prime.policy?.title)).toBe(true);
    expect(nonEmpty(prime.policy?.body)).toBe(true);
    expect(nonEmpty(prime.pullQuote?.text)).toBe(true);
    expect(editableTextPaths(prime)).toEqual(expect.arrayContaining(['policy.title', 'policy.body', 'pullQuote.text']));
  });

  test('prime-only paths are not offered for other templates', async () => {
    const luxe = (await fixtures())[0].data;
    expect(editableTextPaths(luxe)).not.toContain('policy.title');
    expect(editableTextPaths(luxe)).not.toContain('pullQuote.text');
  });

  test('every editable path is reachable (tappable in the preview) or listed in SHEET_ONLY_PATHS', async () => {
    const problems: string[] = [];
    let checked = 0;
    for (const { name, data } of await fixtures()) {
      const template = (data.template || 'luxe') as TemplateId;
      const html = editableDoc(data);
      for (const path of editableTextPaths(data)) {
        if (!nonEmpty(getPath(data, path))) continue;
        checked++;
        const tappable = html.includes(`<span data-edit="${path}">`);
        if (!tappable && !isSheetOnly(template, path)) problems.push(`${name}: ${path}`);
      }
    }
    expect(problems).toEqual([]);
    expect(checked).toBeGreaterThan(60);
  });

  test('the tappable span holds exactly the rendered value', async () => {
    const luxe = (await fixtures())[0].data;
    const html = editableDoc(luxe);
    expect(html).toContain(`<span data-edit="hero.tagline">${luxe.hero.tagline}</span>`);
    expect(html).toContain(`<span data-edit="services.0.title">${luxe.services[0].title}</span>`);
    // prime escapes values; the span wraps the escaped text
    const prime = (await fixtures())[1].data;
    expect(editableDoc(prime)).toContain('<span data-edit="pullQuote.text">A great cut isn&#39;t a transaction — it&#39;s a craft.</span>');
  });

  test('SHEET_ONLY_PATHS only names editable paths', () => {
    for (const list of Object.values(SHEET_ONLY_PATHS)) {
      for (const p of list) expect(EDITABLE_TEXT_PATHS).toContain(p);
    }
  });

  test('why the sheet-only paths are sheet-only: the template transforms or hides them', async () => {
    const luxe = (await fixtures())[0].data;
    // bookingUrl only ever lands in href attributes
    for (const t of ['luxe', 'prime', 'euphoria'] as const) {
      const html = editableDoc({ ...luxe, template: t, bookingUrl: 'https://booksy.com/x' });
      expect(html).not.toContain('data-edit="bookingUrl"');
    }
    // area: cityStateOnly() drops the leading parts of a long address
    const long = { ...luxe, area: '1 Main St, Brooklyn, NY' };
    for (const t of ['luxe', 'prime', 'euphoria'] as const) {
      expect(editableDoc({ ...long, template: t })).not.toContain('data-edit="area"');
    }
    // services.{i}.subtitle: luxe/prime show `duration || subtitle`
    const withDuration = { ...luxe, services: luxe.services.map((s) => ({ ...s, duration: '30 min' })) };
    for (const t of ['luxe', 'prime'] as const) {
      expect(editableDoc({ ...withDuration, template: t })).not.toContain('data-edit="services.0.subtitle"');
    }
  });

  test('no marker survives anywhere in the prepared preview, including attributes, <title> and the map iframe', async () => {
    for (const { data } of await fixtures()) {
      const html = editableDoc(data);
      expect(html).not.toContain(MARK);
      expect(html.toUpperCase()).not.toContain('%E2%81%A3');
      const title = /<title>([\s\S]*?)<\/title>/.exec(html)![1];
      expect(title).toContain(stripMarkers(data.shopName));
    }
  });

  test('marker ids never contain digits (prime folds phone digits into tel:)', async () => {
    const prime = (await fixtures())[1].data;
    const { marked } = markData(prime);
    const digitsOnly = (s: string) => s.replace(/\D/g, '');
    expect(digitsOnly(marked.phone)).toBe(digitsOnly(prime.phone));
  });

  test('empty values are never marked (templates branch on truthiness)', async () => {
    const luxe = (await fixtures())[0].data;
    const d = { ...luxe, bookingUrl: '', contact: { ...luxe.contact, address: '' } };
    const { marked } = markData(d);
    expect(marked.bookingUrl).toBe('');
    expect(marked.contact.address).toBe('');
  });
});

describe('markers', () => {
  test('stripMarkers leaves no U+2063', async () => {
    for (const { data } of await fixtures()) {
      const s = stripMarkers(JSON.stringify(markData(data).marked));
      expect(s).not.toContain(MARK);
    }
    expect(stripMarkers(`a${MARK}b${MARK}c${MARK}/${MARK}d${MARK}`)).toBe('acd');
  });

  test('published payload never contains markers', async () => {
    for (const { data } of await fixtures()) {
      expect(stripMarkers(JSON.stringify(markData(data).marked))).toBe(JSON.stringify(data));
    }
  });

  test('markData does not mutate its input and maps every id to a path', async () => {
    const luxe = (await fixtures())[0].data;
    const before = JSON.stringify(luxe);
    const { ids } = markData(luxe);
    expect(JSON.stringify(luxe)).toBe(before);
    for (const [id, path] of Object.entries(ids)) {
      expect(id).toMatch(/^[a-z]+$/);
      expect(editableTextPaths(luxe)).toContain(path);
    }
  });
});

describe('getPath / setPath', () => {
  test('setPath updates nested arrays immutably', async () => {
    const d = (await fixtures())[0].data;
    const next = setPath(d, 'services.1.title', 'Skin Fade');
    expect(getPath(next, 'services.1.title')).toBe('Skin Fade');
    expect(getPath(d, 'services.1.title')).not.toBe('Skin Fade');
    expect(next).not.toBe(d);
    expect(next.services).not.toBe(d.services);
    expect(Array.isArray(next.services)).toBe(true);
    expect(next.services[1]).not.toBe(d.services[1]);
    expect(next.services[0]).toBe(d.services[0]); // untouched siblings are shared
    expect(next.hero).toBe(d.hero);

    const d2 = setPath(d, 'about.description.0', 'New first paragraph');
    expect(d2.about.description[0]).toBe('New first paragraph');
    expect(d.about.description[0]).not.toBe('New first paragraph');
    expect(Array.isArray(d2.about.description)).toBe(true);

    const d3 = setPath(d, 'gallery.3', 'https://cdn.example.com/x.jpg');
    expect(d3.gallery[3]).toBe('https://cdn.example.com/x.jpg');
    expect(d.gallery[3]).toBe('');
  });

  test('setPath creates missing containers', () => {
    const d = { shopName: 'A' } as unknown as WebsiteData;
    const next = setPath(d, 'policy.title', 'Before you arrive');
    expect(next.policy).toEqual({ title: 'Before you arrive' });
    const n2 = setPath(d, 'staff.0.photo', 'https://x/y.jpg');
    expect(Array.isArray(n2.staff)).toBe(true);
    expect(n2.staff![0].photo).toBe('https://x/y.jpg');
  });

  test('getPath returns undefined for missing paths', async () => {
    const d = (await fixtures())[0].data;
    expect(getPath(d, 'policy.title')).toBeUndefined();
    expect(getPath(d, 'services.99.title')).toBeUndefined();
    expect(getPath(d, 'hero.heading')).toBe(d.hero.heading);
  });
});

describe('images', () => {
  test('IMAGE_PATHS lists every image slot', async () => {
    const d: WebsiteData = {
      ...(await fixtures())[0].data,
      gallery: ['a', '', 'c'],
      craftImages: ['x', 'y'],
      staff: [{ name: 'S', photo: '' }],
    };
    expect(IMAGE_PATHS(d)).toEqual([
      'hero.imageUrl',
      'about.imageUrl',
      'gallery.0',
      'gallery.1',
      'gallery.2',
      'craftImages.0',
      'craftImages.1',
      'staff.0.photo',
    ]);
  });

  test('tagImageSlots tags image placeholders by slot, not by URL', () => {
    const html = '<img src="{{hero}}" alt=""><img src="{{gallery2}}"><img src="{{craft1}}"><img src="{{staff0}}"><img src="{{about}}">';
    const out = tagImageSlots(html);
    expect(out).toContain('src="{{hero}}" data-edit-image="hero.imageUrl"');
    expect(out).toContain('src="{{gallery2}}" data-edit-image="gallery.2"');
    expect(out).toContain('src="{{craft1}}" data-edit-image="craftImages.1"');
    expect(out).toContain('src="{{staff0}}" data-edit-image="staff.0.photo"');
    expect(out).toContain('src="{{about}}" data-edit-image="about.imageUrl"');
  });

  test('buildPreviewHtml (editable) tags the real scrape images by slot even when URLs repeat', async () => {
    const scraped = (await fixtures())[3].data;
    // in the real scrape gallery[1] is the same URL as about.imageUrl
    expect(scraped.gallery[1]).toBe(scraped.about.imageUrl);
    const html = buildPreviewHtml(scraped, true);
    expect(html).toContain(`src="${scraped.about.imageUrl}" data-edit-image="about.imageUrl" alt="Barber Shop Atmosphere"`);
    expect(html).not.toContain('data-edit-image="gallery.1"'); // luxe does not render gallery slot 1
    expect(html).not.toMatch(/\{\{[a-zA-Z0-9]+\}\}/);
    expect(html).not.toContain(MARK);
    for (const p of html.match(/data-edit-image="([^"]+)"/g) || []) {
      expect(IMAGE_PATHS(scraped)).toContain(p.slice('data-edit-image="'.length, -1));
    }
  });

  test('buildPreviewHtml (read-only) has no edit hooks and no markers', async () => {
    const d = (await fixtures())[0].data;
    const html = buildPreviewHtml(d, false);
    expect(html).not.toContain('data-edit');
    expect(html).not.toContain(MARK);
    expect(html).toContain(d.hero.imageUrl);
  });
});

describe('EDITOR_JS', () => {
  test('is valid JavaScript', () => {
    expect(() => new Function(EDITOR_JS)).not.toThrow();
  });

  test('posts only the bridge message types the native side accepts', () => {
    expect(EDITOR_JS).toContain("type: 'edit'");
    expect(EDITOR_JS).toContain("type: 'image'");
    expect(EDITOR_JS).toContain("type: 'scrollY'");
    expect(EDITOR_JS).toContain("type: 'ready'");
    expect(EDITOR_JS).toContain('String.fromCharCode(0x2063)'); // defensive marker sweep
    expect(EDITOR_JS).toMatch(/^[\x00-\x7f]*$/); // ASCII-only source

  });
});
