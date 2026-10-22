import { generateContent } from '@/web/services/geminiService';
import { DEFAULT_PULLQUOTE } from '@/web/lib/render/prime';
import { photoAlt } from '@/web/lib/render/honest';
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
  sheetOnlyImagePaths,
  stripMarkers,
  stripTracking,
  tagImageSlots,
} from '@/lib/editable';

const booksy = require('./fixtures/scrape-booksy.json');
const MARK = '\u2063';

// Honest sites: generateContent never invents a menu, so the fixtures tick services like a barber would.
const inputs = {
  shopName: 'Fresh Cuts', area: 'Brooklyn, NY', phone: '555-0100',
  services: [{ title: 'Haircut', price: '$30' }, { title: 'Skin fade' }, { title: 'Beard trim', price: '$15' }],
};

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
    // No default policy any more (DEFAULT_POLICY is empty): a barber-written one.
    policy: { title: 'Please note', body: 'Arrive five minutes early.' },
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
    // Neutral alt text now (honest.ts photoAlt): the shop name + "photo", never "Barber Shop Atmosphere".
    expect(html).toContain(`src="${scraped.about.imageUrl}" data-edit-image="about.imageUrl" alt="${photoAlt(scraped)}"`);
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

describe('image slots: tappable or sheet-only', () => {
  const TEMPLATES = ['luxe', 'prime', 'euphoria'] as const;
  const u = (k: string) => `https://cdn.example.com/${k}.jpg`;
  // Variants that hit every image branch of the templates: filled, empty,
  // staff with and without a photo, craft images, 8 gallery slots.
  const variants = (d: WebsiteData): { name: string; data: WebsiteData }[] => [
    { name: 'as-is', data: d },
    {
      name: 'rich',
      data: {
        ...d,
        gallery: [0, 1, 2, 3, 4, 5, 6, 7].map((i) => u(`g${i}`)),
        craftImages: [0, 1, 2, 3].map((i) => u(`c${i}`)),
        staff: [
          { name: 'Sam', role: 'Barber', photo: u('s0') },
          { name: 'Ali', role: 'Barber', photo: '' },
        ],
      },
    },
    {
      name: 'empty',
      data: {
        ...d,
        hero: { ...d.hero, imageUrl: '' },
        about: { ...d.about, imageUrl: '' },
        gallery: ['', '', '', '', '', '', '', ''],
        craftImages: ['', ''],
        staff: [{ name: 'Sam', photo: '' }],
      },
    },
  ];

  test('every IMAGE_PATHS slot is a tap target or in sheetOnlyImagePaths, never both', async () => {
    const problems: string[] = [];
    let tappableCount = 0;
    let sheetCount = 0;
    for (const { name, data: base } of await fixtures()) {
      for (const template of TEMPLATES) {
        for (const v of variants({ ...base, template })) {
          const d = v.data;
          const html = buildPreviewHtml(d, true);
          const sheet = sheetOnlyImagePaths(d);
          for (const path of IMAGE_PATHS(d)) {
            const tappable = html.includes(`data-edit-image="${path}"`);
            const sheetOnly = sheet.includes(path);
            if (tappable) tappableCount++;
            if (sheetOnly) sheetCount++;
            if (!tappable && !sheetOnly) problems.push(`${name}/${template}/${v.name}: ${path} neither tappable nor sheet-only`);
            if (tappable && sheetOnly) problems.push(`${name}/${template}/${v.name}: ${path} tappable but listed sheet-only`);
          }
          for (const p of sheet) if (!IMAGE_PATHS(d).includes(p)) problems.push(`${template}: unknown sheet path ${p}`);
        }
      }
    }
    expect(problems).toEqual([]);
    expect(tappableCount).toBeGreaterThan(80);
    expect(sheetCount).toBeGreaterThan(80);
  });

  test('known non-tappable slots are sheet-only', async () => {
    const base = (await fixtures())[0].data;
    const rich = variants(base)[1].data;
    expect(sheetOnlyImagePaths({ ...rich, template: 'luxe' })).toEqual(
      expect.arrayContaining(['gallery.0', 'gallery.1', 'craftImages.0', 'staff.1.photo']),
    );
    expect(sheetOnlyImagePaths({ ...rich, template: 'luxe' })).not.toContain('staff.0.photo');
    expect(sheetOnlyImagePaths({ ...rich, template: 'prime' })).toEqual(
      expect.arrayContaining(['gallery.6', 'gallery.7', 'craftImages.3', 'staff.0.photo']),
    );
    const empty = variants(base)[2].data;
    expect(sheetOnlyImagePaths({ ...empty, template: 'prime' })).toContain('hero.imageUrl');
    expect(sheetOnlyImagePaths({ ...empty, template: 'luxe' })).not.toContain('hero.imageUrl'); // luxe always renders the hero <img>
  });
});

describe('stripTracking (preview only)', () => {
  test('removes analytics tags from the preview, keeps Tailwind, leaves published output alone', async () => {
    const base = (await fixtures())[0].data;
    for (const template of ['luxe', 'prime', 'euphoria'] as const) {
      const d = { ...base, template };
      const published = renderSite(forRender(d));
      expect(published).toContain('clarity.ms');
      for (const editable of [true, false]) {
        const html = buildPreviewHtml(d, editable);
        expect(html).not.toContain('clarity.ms');
        if (published.includes('cdn.tailwindcss.com')) expect(html).toContain('<script src="https://cdn.tailwindcss.com"></script>');
        // other inline scripts survive (luxe header scroll handler)
        if (template === 'luxe') expect(html).toContain("window.addEventListener('scroll'");
      }
    }
    expect(renderSite(forRender({ ...base, template: 'luxe' }))).toContain('cdn.tailwindcss.com');
  });

  test('strips gtag and fbq snippets, inline or by src', () => {
    const html = [
      '<head>',
      '<script async src="https://www.googletagmanager.com/gtag/js?id=G-1"></script>',
      "<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());</script>",
      "<script>!function(f,b,e,v,n,t,s){}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','1');</script>",
      "<script type=\"text/javascript\">ttq.load('X')</script>",
      '<script src="https://cdn.tailwindcss.com"></script>',
      '<script>console.log("keep")</script>',
      '</head>',
    ].join('\n');
    const out = stripTracking(html);
    for (const gone of ['googletagmanager', 'gtag(', 'fbq(', 'connect.facebook.net', 'ttq.']) expect(out).not.toContain(gone);
    expect(out).toContain('<script src="https://cdn.tailwindcss.com"></script>');
    expect(out).toContain('<script>console.log("keep")</script>');
  });
});

describe('marker edge cases', () => {
  test('a ">" in shopName does not put an edit span inside the meta description attribute', async () => {
    const luxe = (await fixtures())[0].data;
    const html = editableDoc({ ...luxe, template: 'luxe', shopName: 'Fresh > Cuts' });
    const start = html.indexOf('<meta name="description"');
    const meta = html.slice(start, html.indexOf('\n', start));
    expect(meta).not.toContain('data-edit');
    expect(meta).toContain('Brooklyn, NY');
  });

  test('an upper-cased marked value strips to no stray id letters', async () => {
    const luxe = (await fixtures())[0].data;
    const { marked } = markData(luxe);
    expect(stripMarkers(marked.hero.tagline.toUpperCase())).toBe(luxe.hero.tagline.toUpperCase());
    expect(stripMarkers(marked.about.description[0].toUpperCase())).toBe(luxe.about.description[0].toUpperCase());
  });
});
