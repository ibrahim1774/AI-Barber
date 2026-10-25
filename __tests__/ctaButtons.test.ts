import type { WebsiteData } from '@/web/types';
import { LABELS } from '@/web/lib/render/labels';
import { buildPageSet } from '@/web/lib/render/pages';
import { buildPreviewHtml, type PreviewPage } from '@/lib/editable';
import { CTA_KINDS, ctaKindOf } from '@/lib/ctaButtons';
import { imageUrlMap } from '@/lib/render';
import { shop } from './pagesV2Fixture';

describe('ctaKindOf', () => {
  it('maps the known buttons', () => {
    expect(ctaKindOf('labels.primeNavBook')).toEqual({ kind: 'book', labelKey: 'primeNavBook' });
    expect(ctaKindOf('labels.callNow')?.kind).toBe('call');
    expect(ctaKindOf('labels.pgDirectionsCta')?.kind).toBe('directions');
    expect(ctaKindOf('labels.euShopButton')?.kind).toBe('shop');
    expect(ctaKindOf('labels.pgBackServices')?.kind).toBe('inSite');
    expect(ctaKindOf('labels.pgBookCta')?.kind).toBe('book');
  });
  it('is null for anything else', () => {
    for (const p of ['labels.heroHeading', 'phone', 'bookingUrl', 'labels.', 'labels.__proto__', 'labels.constructor', 'copy.faq.book', '', 'labels.callNow#x']) {
      expect(ctaKindOf(p)).toBeNull();
    }
  });
  it('every registry key exists in the label registry', () => {
    for (const k of Object.keys(CTA_KINDS)) expect(Object.keys(LABELS)).toContain(k);
  });
});

// Every button the designs render must be in the registry: a Book / Call / Directions button added to the
// renderer later without an entry fails here instead of silently opening the plain text box.
const BOOKSY = 'https://booksy.com/x';
const isCtaHref = (h: string) => /^\/book(?:[/?#]|$)/.test(h) || h === BOOKSY || h.startsWith('tel:') || h.startsWith('https://www.google.com/maps/search/');

function pagesOf(d: WebsiteData): PreviewPage[] {
  const set = buildPageSet(d, { imageUrls: imageUrlMap(d) });
  return set.files.map((f) => (f.child ? { key: f.key, index: f.child.index } : { key: f.key }));
}

async function base(template: 'luxe' | 'prime' | 'euphoria', multi: boolean, bookingUrl: string | undefined): Promise<WebsiteData> {
  const d = await shop({
    template,
    staff: [
      { name: 'Sam', photo: '', bio: 'Sam has cut hair for ten years in Brooklyn and loves a clean skin fade.', bookingUrl: 'https://booksy.com/sam' },
      { name: 'Alex', photo: '' },
    ] as never,
  });
  const out = { ...d, bookingUrl } as WebsiteData & { shopUrl?: string };
  if (!bookingUrl) delete out.bookingUrl;
  out.shopUrl = '/shop';
  if (!multi) delete (out as { pages?: unknown }).pages;
  return out;
}

describe.each(['luxe', 'prime', 'euphoria'] as const)('completeness: %s', (template) => {
  it.each([[true], [false]])('multi-page=%s', async (multi) => {
    const missing: string[] = [];
    const seen = new Set<string>();
    for (const bookingUrl of ['/book', BOOKSY, undefined]) {
      const d = await base(template, multi, bookingUrl);
      for (const page of multi ? pagesOf(d) : [{ key: 'home' } as PreviewPage]) {
        const html = buildPreviewHtml(d, true, null, page);
        for (const m of html.matchAll(/<a\b[^>]*?\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/g)) {
          const href = m[1].replace(/&amp;/g, '&');
          if (!isCtaHref(href)) continue;
          const keys = [...m[2].matchAll(/data-edit="([^"]+)"/g)].map((x) => x[1]);
          for (const k of keys) { const c = ctaKindOf(k); if (c) seen.add(c.kind); else if (k === 'phone') seen.add('call'); }
          const ok = keys.some((k) => ctaKindOf(k) || k === 'phone' || k === 'contact.address');
          if (!ok) missing.push(`${template} ${multi ? page.key : 'single'} ${String(bookingUrl)} ${href} -> ${keys.join(',') || 'no data-edit'}`);
        }
      }
    }
    expect(missing).toEqual([]);
    // The scan really finds buttons: Book and Call on every design, Directions on the Location page.
    expect(seen.has('book')).toBe(true);
    expect(seen.has('call')).toBe(true);
    if (multi) expect(seen.has('directions')).toBe(true);
  });
});
