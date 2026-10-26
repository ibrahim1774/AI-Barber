// Item 6 audit: every visible word of the generated site is editable in the editor, except a short, named list of
// text that is a fact or ornament. Runs over the real vendored renderer, every design, single page and every page of
// a multi-page site, rendered the way the editor previews it (editable, so each editable value sits in a data-edit span).
import { generateContent } from '@/web/services/geminiService';
import { buildPageSet, EXTRA_KEYS } from '@/web/lib/render/pages';
import type { TemplateId, WebsiteData } from '@/web/types';
import { buildPreviewHtml, previewEditPaths, textValue, type PreviewPage } from '@/lib/editable';
import { imageUrlMap } from '@/lib/render';
import { defaultPages } from '@/lib/sitePages';

const week = (open: string, close: string) =>
  ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (day === 'Sun' ? { day, open: '', close: '', closed: true } : { day, open, close }));

async function rich(template: TemplateId, multi: boolean): Promise<WebsiteData> {
  const g = await generateContent({
    shopName: 'Fresh Cuts', area: 'Brooklyn, NY', phone: '5125550142', template,
    services: [{ title: 'Haircut', price: '$30' }, { title: 'Skin fade', price: '$35' }],
  } as never);
  const d = {
    ...g, template, bio: 'A neighbourhood shop.',
    reviews: [{ author: 'Al Smith', comment: 'Great cut', rating: 5 }],
    hours: week('09:00', '17:00'),
    staff: [{ name: 'Sam Fade', role: 'Owner', bio: 'Sam fades.', bookingUrl: 'https://booksy.com/sam', hours: week('08:00', '16:00') }],
    bookingUrl: 'https://booksy.com/x',
    contact: { address: '1 Main St, Brooklyn, NY', email: 'hi@example.com' },
  } as unknown as WebsiteData;
  return multi ? ({ ...d, pages: defaultPages(), extraPages: { on: [...EXTRA_KEYS], serviceGuides: true } } as WebsiteData) : d;
}

const decode = (s: string) => s.replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/&copy;/g, '©').replace(/&middot;/g, '·').replace(/&amp;/g, '&');

/** Visible text left over once every tap target is removed. */
export function uneditableText(html: string): string[] {
  let h = html.replace(/<!--[\s\S]*?-->/g, '').replace(/<(script|style|svg|head|noscript)\b[\s\S]*?<\/\1>/gi, '');
  h = h.replace(/<span data-edit="[^"]*">[^<]*<\/span>/g, ' ');
  return decode(h.replace(/<[^>]*>/g, '\n')).split('\n').map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** Visible text that is intentionally not editable: a fact the barber does not write, or ornament. */
const ALLOWED: [RegExp, string][] = [
  [/^[\d\s.,/·|:–-]+$/, 'numbers, ratings, years and decorative numerals'],
  [/^[A-Z]{1,3}$/, 'avatar initials'],
  [/^[★☆]+$|^[\d.]+\s*[★☆]/, 'star glyphs'],
  [/^[ -~]{0,2}$/, 'single glyphs and separators'],
  [/^(Copyright )?(©|&copy;)\s*\d{4}[\s.·]*$/, 'the generated copyright stem (year, shop name is editable); the credit after it is editable'],
  [/^Report this site$/, 'the fixed "Report this site" footer mailto link (server reportLinkHtml): not the barber\'s wording'],
  [/^[“"]?Great cut[”"]?$|^Al Smith$|^Reviews from \w+$/, 'customer review quote, author and source: facts, not the barber\'s wording'],
];

const TEMPLATES: TemplateId[] = ['luxe', 'prime', 'euphoria'];

function pagesOf(d: WebsiteData): PreviewPage[] {
  if (!d.pages) return [{ key: 'home' }];
  return buildPageSet(d, { imageUrls: imageUrlMap(d) }).files.map((f) => (f.child ? { key: f.key, index: f.child.index } : { key: f.key })) as PreviewPage[];
}

describe.each(TEMPLATES)('%s: visible text is editable', (template) => {
  test.each([false, true])('multi-page=%s', async (multi) => {
    const d = await rich(template, multi);
    const loose: Record<string, string[]> = {};
    for (const p of pagesOf(d)) {
      const html = buildPreviewHtml(d, true, null, p);
      for (const t of uneditableText(html)) {
        if (ALLOWED.some(([re]) => re.test(t))) continue;
        (loose[t] ||= []).push(p.key);
      }
    }
    expect(loose).toEqual({});
  });

  test('the footer credit is editable and printed in the footer', async () => {
    const d = await rich(template, false);
    expect(previewEditPaths(d)).toContain('labels.footerCredit');
    expect(textValue(d, 'labels.footerCredit')).toBe('Built by Prime Barber');
    const html = buildPreviewHtml(d, true, null, { key: 'home' });
    expect(html).toMatch(/<span data-edit="labels\.footerCredit">Built by Prime Barber<\/span>/);
    const edited = buildPreviewHtml({ ...d, labels: { ...(d as any).labels, footerCredit: 'Made with care' } } as WebsiteData, true, null, { key: 'home' });
    expect(edited).toContain('Made with care');
  });
});
