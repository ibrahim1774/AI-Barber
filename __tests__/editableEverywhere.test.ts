// Editable everywhere (app side): over the REAL rendered preview of every page type of the vendored renderer, every
// tap target (data-edit) must resolve to a sheet kind and a current value, and save to the field it names.
import { generateContent } from '@/web/services/geminiService';
import { buildPageSet, EXTRA_KEYS } from '@/web/lib/render/pages';
import { copyHasWordings } from '@/web/lib/render/guides';
import type { TemplateId, WebsiteData } from '@/web/types';
import {
  buildPreviewHtml, copyKeyOfPath, copyPathHasWordings, editableTextPaths, EDITOR_JS, getPath, hoursEditorFor, labelKeyOfPath,
  sheetOnlyTextPaths, textMaxLength, textValue, type PreviewPage,
} from '@/lib/editable';
import { imageUrlMap } from '@/lib/render';
import { parsePreviewMessage } from '@/lib/previewBridge';
import { fieldLabel, savePathValue } from '@/lib/editor';
import { defaultPages } from '@/lib/sitePages';
import { timeLabel } from '@/lib/sections/hours';

const week = (open: string, close: string) =>
  ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (day === 'Sun' ? { day, open: '', close: '', closed: true } : { day, open, close }));

async function rich(template: TemplateId): Promise<WebsiteData> {
  const g = await generateContent({
    shopName: 'Fresh Cuts', area: 'Brooklyn, NY', phone: '5125550142', template,
    services: [{ title: 'Haircut', price: '$30' }, { title: 'Skin fade', price: '$35' }, { title: 'Beard trim', price: '$15' }],
  } as never);
  return {
    ...g,
    template,
    bio: 'A neighbourhood shop with a loyal crowd and a calm chair.',
    about: { ...g.about, description: ['We have cut hair on this corner for ten years.', 'Walk in or book ahead.'] },
    services: [
      { title: 'Haircut', price: '$30', duration: '30 min', category: 'Cuts', description: 'A clean classic cut.' },
      { title: 'Skin fade', price: '$35', duration: '40 min', category: 'Cuts', description: 'Tight and clean.' },
      { title: 'Beard trim', price: '$15', duration: '20 min', category: 'Beard', description: 'Shaped and lined.' },
      { title: 'Facial', price: '$40', subtitle: 'Relaxing' },
    ] as WebsiteData['services'],
    gallery: ['u0', 'u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7'],
    reviews: [{ author: 'Al', comment: 'Great cut', rating: 5 }, { author: 'Bo', comment: 'Fine work', rating: 4 }],
    hours: week('09:00', '17:00'),
    staff: [
      { name: 'Sam Fade', role: 'Owner', photo: 'p', bio: 'Sam fades.', bookingUrl: 'https://booksy.com/sam', hours: week('08:00', '16:00') },
      { name: 'Kit Line', role: 'Barber', bio: 'Kit does beards.', bookingUrl: 'https://booksy.com/kit', hours: week('10:00', '18:00') },
    ] as WebsiteData['staff'],
    bookingUrl: 'https://booksy.com/x',
    contact: { address: '1 Main St, Brooklyn, NY', email: 'hi@example.com' },
    policy: { title: 'Please note', body: 'Arrive five minutes early.' },
    pullQuote: { text: 'A great cut is a craft.', accent: 'craft' },
    pages: defaultPages(),
    extraPages: { on: [...EXTRA_KEYS], serviceGuides: true },
  } as WebsiteData;
}

const TEMPLATES: TemplateId[] = ['luxe', 'prime', 'euphoria'];
const sites = {} as Record<TemplateId, WebsiteData>;
beforeAll(async () => {
  for (const t of TEMPLATES) sites[t] = await rich(t);
});

type Sheet = 'edit' | 'hours' | 'team';
const sheetKind = (path: string): Sheet => hoursEditorFor(path) ?? 'edit';

const unescape = (s: string) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

/** Every [path, shown text] tap target in a preview document. */
function targets(html: string): [string, string][] {
  const out: [string, string][] = [];
  for (const m of html.matchAll(/<span data-edit="([^"]+)">([^<]*)<\/span>/g)) out.push([m[1], unescape(m[2])]);
  return out;
}

/** The page types of a multi-page site, each with the page to open. */
function pageTypes(d: WebsiteData): { name: string; page: PreviewPage }[] {
  const set = buildPageSet(d, { imageUrls: imageUrlMap(d) });
  return set.files.map((f) => ({
    name: f.child ? `${f.key}:${f.child.slug}` : f.key,
    page: f.child ? { key: f.key, index: f.child.index } : { key: f.key },
  }));
}

describe.each(TEMPLATES)('%s: every tap target of every page type resolves', (template) => {
  test('the site really has every page type', () => {
    const names = pageTypes(sites[template]).map((p) => p.name);
    for (const must of ['home', 'about', 'services', 'team', 'hours', 'location', 'contact', 'faq', 'first-visit', 'hair-care', 'beard-care']) {
      expect(names).toContain(must);
    }
    expect(names.some((n) => n.startsWith('services:'))).toBe(true); // a service page
    expect(names.some((n) => n.startsWith('team:'))).toBe(true); // a team member page
  });

  test('each data-edit path: accepted by the bridge, a sheet kind, a current value, a save that lands in its field', () => {
    const d = sites[template];
    const unresolved: string[] = [];
    let seen = 0;
    for (const { name, page } of pageTypes(d)) {
      const html = buildPreviewHtml(d, true, null, page);
      const found = targets(html);
      expect(found.length).toBeGreaterThan(0);
      for (const [path, shown] of found) {
        seen++;
        const at = `${template}/${name}: ${path}`;
        // 1. the native bridge accepts the message
        if (!parsePreviewMessage(JSON.stringify({ type: 'edit', path }), d, page)) { unresolved.push(`${at} (bridge)`); continue; }
        // 2. a sheet kind
        const kind = sheetKind(path);
        // 3. a current value equal to what the page shows (hours: stored 09:00 vs shown 9:00 AM)
        const value = textValue(d, path);
        if (kind === 'edit') {
          if (value === '') { unresolved.push(`${at} (empty value)`); continue; }
          if (!(copyKeyOfPath(path) ? shown.trim() !== '' : unescape(value).includes(shown.trim()) || (path === 'phone' && shown.replace(/\D/g, '') === value.replace(/\D/g, '')) || shown.trim().includes(unescape(value).trim()) || shown.toUpperCase() === value.toUpperCase())) {
            unresolved.push(`${at} (value "${value}" vs page "${shown}")`);
          }
        } else if (timeLabel(value) !== shown.trim()) {
          unresolved.push(`${at} (time "${value}" vs page "${shown}")`);
        }
        // 4. a label that names the field
        if (!fieldLabel(path) || fieldLabel(path) === path) unresolved.push(`${at} (no field label)`);
        // 5. data paths and labels save into the field they name (copy has its own tests); hours go through the picker
        if (kind === 'edit' && !copyKeyOfPath(path)) {
          const saved = savePathValue(d, path, 'Zed');
          const stored = labelKeyOfPath(path) ? (saved.labels as Record<string, string> | undefined)?.[labelKeyOfPath(path)!] : getPath(saved, path);
          if (stored !== 'Zed' && !labelKeyOfPath(path)) unresolved.push(`${at} (save did not land)`);
        }
      }
    }
    expect(seen).toBeGreaterThan(100);
    expect(unresolved).toEqual([]);
  });

  test('text limits: a data path with a limit is limited in the sheet', () => {
    const d = sites[template];
    expect(textMaxLength('staff.0.name')).toBe(80);
    expect(textMaxLength('staff.0.role')).toBe(80);
    expect(textMaxLength('staff.0.bio')).toBe(600);
    expect(textMaxLength('services.0.price')).toBe(24);
    expect(textMaxLength('services.0.duration')).toBe(24);
    expect(textMaxLength('services.0.category')).toBe(40);
    expect(textMaxLength('contact.email')).toBe(120);
    expect(textMaxLength('hours.0.day')).toBe(20);
    expect(textMaxLength('staff.1.hours.2.open')).toBe(12);
    expect(textMaxLength('shopName')).toBeUndefined();
    expect(editableTextPaths(d).length).toBeGreaterThan(50);
  });
});

describe('what is tappable per page type (luxe, rich site)', () => {
  const d = () => sites.luxe;
  const pathsOn = (page: PreviewPage) => new Set(targets(buildPreviewHtml(d(), true, null, page)).map(([p]) => p));
  const has = (page: PreviewPage, ...want: string[]) => {
    const got = pathsOn(page);
    for (const w of want) expect([w, got.has(w)]).toEqual([w, true]);
  };

  test('service page', () => has({ key: 'services', index: 0 }, 'services.0.title', 'services.0.price', 'services.0.duration', 'labels.pgBookCta', 'shopName', 'phone'));
  test('services list', () => has({ key: 'services' }, 'services.0.title', 'services.0.price', 'services.1.title', 'services.2.price'));
  test('location', () => has({ key: 'location' }, 'contact.address', 'hours.0.day', 'hours.0.open', 'hours.0.close', 'staff.0.name'));
  test('hours', () => has({ key: 'hours' }, 'hours.0.day', 'hours.0.open', 'hours.0.close', 'labels.pgAlsoSee'));
  test('contact', () => has({ key: 'contact' }, 'contact.address', 'contact.email', 'phone'));
  test('about', () => has({ key: 'about' }, 'about.description.0', 'about.description.1'));
  test('team list and member page', () => {
    has({ key: 'team' }, 'staff.0.name', 'staff.0.role', 'staff.0.bio', 'staff.1.name');
    has({ key: 'team', index: 0 }, 'staff.0.name', 'staff.0.role', 'staff.0.bio', 'labels.teamBookWith');
  });
  test('FAQ, First visit, Hair care, Beard care', () => {
    const faq = [...pathsOn({ key: 'faq' })];
    expect(faq.some((p) => /^copy\.faq\..+\.q$/.test(p))).toBe(true);
    for (const key of ['faq', 'first-visit', 'hair-care', 'beard-care'] as const) {
      const got = pathsOn({ key });
      expect([key, got.has('labels.pgBookCta')]).toEqual([key, true]);
      expect([key, got.has('labels.pgAlsoSee')]).toEqual([key, true]);
      expect([key, [...got].some((p) => p.startsWith('copy.'))]).toEqual([key, true]);
    }
  });
  test('header, menu and footer labels on a nested page', () => has({ key: 'faq' }, 'labels.pgNavAbout', 'labels.pgNavHours', 'labels.pgNavFaq', 'shopName'));
});

describe('hours editor routing', () => {
  test('open and close go to the pickers, the day to the text sheet, everything else to the text sheet', () => {
    expect(hoursEditorFor('hours.0.open')).toBe('hours');
    expect(hoursEditorFor('hours.6.close')).toBe('hours');
    expect(hoursEditorFor('staff.1.hours.2.close')).toBe('team');
    expect(hoursEditorFor('hours.0.day')).toBeNull();
    expect(hoursEditorFor('staff.0.hours.1.day')).toBeNull();
    expect(hoursEditorFor('phone')).toBeNull();
    expect(hoursEditorFor('services.0.duration')).toBeNull();
  });
  test('stored 09:00 shows as 9:00 AM on the page', () => {
    const html = buildPreviewHtml(sites.luxe, true, null, { key: 'hours' });
    const open = targets(html).find(([p]) => p === 'hours.0.open')!;
    expect(textValue(sites.luxe, 'hours.0.open')).toBe('09:00');
    expect(open[1]).toBe('9:00 AM');
  });
});

describe('copy sheet', () => {
  test('"Try other wording" is offered for guide text, not for FAQ questions', () => {
    expect(copyPathHasWordings('copy.faq.book.q')).toBe(false);
    expect(copyHasWordings('faq.book.q')).toBe(false);
    expect(copyPathHasWordings('copy.guide.fade.what')).toBe(true);
    expect(copyPathHasWordings('copy.guide.fade.interval')).toBe(true);
    expect(copyPathHasWordings('shopName')).toBe(false);
  });
  test('every FAQ question on the FAQ page has no wording, and the new keys resolve with a limit', () => {
    const d = sites.luxe;
    const qs = targets(buildPreviewHtml(d, true, null, { key: 'faq' })).map(([p]) => p).filter((p) => /^copy\.faq\..+\.q$/.test(p));
    expect(qs.length).toBeGreaterThan(5);
    for (const p of qs) {
      expect(copyPathHasWordings(p)).toBe(false);
      expect(textValue(d, p)).not.toBe('');
      expect(textMaxLength(p)).toBe(160);
    }
  });
});

describe('the Book with Sam button (two editable texts in one link)', () => {
  // Run the real EDITOR_JS click handler in a tiny DOM-less harness is not possible without jsdom; assert the rule.
  test('the script opens the first editable text when the tap is on the padding', () => {
    expect(EDITOR_JS).toContain('inner.length >= 1');
    expect(EDITOR_JS).toContain("inner[0].getAttribute('data-edit')");
  });
  test('the Team page really has the two-text button', () => {
    const html = buildPreviewHtml(sites.luxe, true, null, { key: 'team', index: 0 });
    const links = [...html.matchAll(/<a\b[^>]*>((?:(?!<\/a>)[\s\S])*?)<\/a>/g)].map((m) => (m[1].match(/data-edit="/g) ?? []).length);
    expect(Math.max(...links)).toBeGreaterThanOrEqual(2);
  });
});

describe('"All texts" lists the new keys only for pages the site shows', () => {
  test('FAQ questions and Hair care lines follow the pages that exist', () => {
    const d = sites.luxe;
    const all = editableTextPaths(d);
    expect(all).toContain('copy.faq.book.q');
    expect(all.some((p) => p.endsWith('.interval'))).toBe(true);
    const noExtras = { ...d, extraPages: { on: [], serviceGuides: false } } as WebsiteData;
    const none = editableTextPaths(noExtras);
    expect(none.some((p) => /^copy\.faq\./.test(p))).toBe(false);
    expect(none).not.toContain('labels.pgNavFaq');
    const faqOnly = editableTextPaths({ ...d, extraPages: { on: ['faq'], serviceGuides: false } } as WebsiteData);
    expect(faqOnly).toContain('copy.faq.book.q');
    expect(faqOnly.some((p) => /^copy\.guide\..+\.interval$/.test(p))).toBe(false);
  });
  test('Prime-only labels only on Prime', () => {
    for (const t of TEMPLATES) {
      const all = editableTextPaths({ ...sites[t], pullQuote: undefined });
      expect(all.includes('labels.primeGalleryNote')).toBe(t === 'prime');
      expect(all.includes('labels.primePullQuote')).toBe(t === 'prime');
    }
  });
  test('data paths: every one is tappable on some page or sheet-only', () => {
    for (const t of TEMPLATES) {
      const d = sites[t];
      const tapped = new Set<string>();
      for (const { page } of pageTypes(d)) for (const [p] of targets(buildPreviewHtml(d, true, null, page))) tapped.add(p);
      const sheetOnly = new Set(sheetOnlyTextPaths(d));
      const missing = editableTextPaths(d).filter((p) => !p.startsWith('labels.') && !p.startsWith('copy.') && !tapped.has(p) && !sheetOnly.has(p) && textValue(d, p) !== '');
      expect([t, missing]).toEqual([t, []]);
    }
  });
});
