// Review fixes for editable-everywhere (2026-10-24): pasted markers never reach published output, marker-only values never crash,
// the preview equals the published page for padded values, and the data-path limits are enforced at render.
import { describe, expect, it } from 'vitest';
import { renderPendingBundle } from '../../lib/publishSite';
import { finalizePages } from '../../lib/deploySite';
import { renderSiteBundle } from '../../lib/render/site';
import { printable, stripMarkersDeep, stripMarkersText } from '../../lib/render/markers';
import { sheetOnlyDataPaths } from '../../lib/render/editPaths';
import { auditSite } from './helpers/editAudit';
import { RICH_SITE, SHORT_SITE } from './helpers/richSite';
import type { TemplateId, WebsiteData } from '../../types';

const M = '⁣';
const TEMPLATES: TemplateId[] = ['luxe', 'prime', 'euphoria'];
const PAYLOADS = [`${M}a${M}X${M}/${M}`, `${M}`, `${M}${M}`, `${M}a${M}X`, `X${M}/${M}`, `${M}ab${M}${M}c${M}Z${M}/${M}${M}/${M}`, `mid${M}dle`, `${M}A${M}Up${M}/${M}`, `${M}a${M} ${M}/${M}`];

/** Every string leaf of the site replaced by `f(leaf)` (one field at a time is too slow: do all leaves of one array/object path per run). */
function leafPaths(v: unknown, trail: string[] = [], out: string[][] = []): string[][] {
  if (typeof v === 'string') out.push(trail);
  else if (Array.isArray(v)) v.forEach((x, i) => leafPaths(x, [...trail, String(i)], out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) leafPaths(x, [...trail, k], out);
  return out;
}
const setAt = (d: any, trail: string[], val: string): any => {
  const c: any = Array.isArray(d) ? [...d] : { ...d };
  c[trail[0]] = trail.length === 1 ? val : setAt(c[trail[0]], trail.slice(1), val);
  return c;
};
const SKIP = new Set(['template', 'niche', 'colorTheme', 'icon']);
const fields = (d: WebsiteData) => leafPaths(d).filter((t) => !SKIP.has(t[t.length - 1]) && !/imageUrl|photo|gallery|bookingUrl|shopUrl|memberId|^pages|extraPages/.test(t.join('.')));

describe('pasted markers never reach published output', () => {
  for (const t of TEMPLATES) for (const multi of [true, false]) {
    it(`${t}${multi ? '' : ' single page'}: every field x every payload, pages and sitemap`, () => {
      const base = { ...RICH_SITE, template: t, labels: { galleryHeading: 'Look' }, copy: { 'faq.book.q': 'Q?', 'guide.fade.interval': 'Often.' } } as WebsiteData;
      if (!multi) delete base.pages;
      const trails = [...fields(base), ['labels', 'galleryHeading'], ['copy', 'faq.book.q'], ['copy', 'guide.fade.interval']];
      for (const payload of PAYLOADS) {
        // all fields at once (cheap), then a rotating handful one by one
        let all: any = base;
        for (const tr of trails) all = setAt(all, tr, payload + String(setAt(base, tr, '') && '') + 'v');
        const out = renderPendingBundle({ siteData: all, imageUrlMap: {} }, { siteBaseUrl: 'https://x.example.com' });
        for (const p of out.pages) {
          expect(p.html, `${p.path} ${JSON.stringify(payload)}`).not.toContain(M);
          expect(p.html).not.toContain('data-edit');
          expect(p.html).not.toMatch(/tel:[^"]*[^\d+()\-.\s"]/);
        }
        expect(out.sitemap ?? '').not.toContain(M);
        for (const p of finalizePages(out.pages, {})) expect(p.html).not.toContain(M);
      }
    });
  }
  it('finalizePages strips markers from pages that came from elsewhere (browser-rendered deploys)', () => {
    const [p] = finalizePages([{ path: 'index.html', html: `<p>${M}a${M}Hi${M}/${M} ${M}</p>` }], {});
    expect(p.html).toBe('<p>Hi </p>');
  });
  it('the strip helpers', () => {
    expect(stripMarkersText(`${M}a${M}X${M}/${M}${M}`)).toBe('X');
    expect(stripMarkersDeep({ a: [`${M}x`, { b: `${M}b${M}y${M}/${M}` }], n: 3 })).toEqual({ a: ['x', { b: 'y' }], n: 3 });
  });
  it('the preview renderer keeps the markers (the app needs them)', () => {
    const d = { ...RICH_SITE, shopName: `${M}a${M}Fresh Cuts${M}/${M}` } as WebsiteData;
    expect(renderSiteBundle(d).pages[1].html).toContain(M);
  });
});

describe('marker-only values do not crash any design', () => {
  for (const t of TEMPLATES) for (const multi of [true, false]) {
    it(`${t}${multi ? '' : ' single page'}`, () => {
      const base = { ...RICH_SITE, template: t } as WebsiteData;
      if (!multi) delete base.pages;
      const trails = fields(base);
      for (const payload of [M, `${M}${M}${M}`, `${M}a${M}${M}/${M}`, `${M}a${M} ${M}/${M}`]) {
        let all: any = base;
        for (const tr of trails) all = setAt(all, tr, payload);
        expect(() => renderSiteBundle(all, { siteBaseUrl: 'https://x.example.com' })).not.toThrow();
        for (const tr of trails) expect(() => renderSiteBundle(setAt(base, tr, payload), {})).not.toThrow();
      }
    });
  }
  it('a staff name made only of markers is not a team member', () => {
    for (const t of TEMPLATES) {
      const d = { ...RICH_SITE, template: t, staff: [{ name: M }, { name: `${M}a${M} ${M}/${M}` }, { name: 'Sam' }] } as WebsiteData;
      const html = renderSiteBundle(d).pages[0].html;
      expect(html).toContain('Sam');
    }
  });
});

describe('preview equals published for padded values', () => {
  it('printable trims inside the wrapper', () => {
    expect(printable(`${M}a${M}  Fresh Cuts ${M}/${M}`)).toBe(`${M}a${M}Fresh Cuts${M}/${M}`);
  });
  it('luxe: padded shop name and padded short bio match the published page', () => {
    const d = { ...RICH_SITE, template: 'luxe', shopName: '  Fresh Cuts ', bio: '   Short bio here ok.     ' } as WebsiteData;
    const noA = (h: string) => h.replace(/<a\b[^>]*>/g, '').replace(/<\/a>/g, '').toLowerCase();
    for (const p of auditSite(d, 'luxe', 'proposed')) {
      const copy = Object.values(p.ids).some((x) => x.startsWith('copy.')); // library blocks with links preview as plain words
      expect(copy ? noA(p.strippedHtml) : p.strippedHtml, p.page).toBe(copy ? noA(p.plainHtml) : p.plainHtml);
    }
  });
});

describe('data-path limits are enforced at render', () => {
  it('price, duration, category, email and hours are cut to editPaths limits (published and preview alike)', () => {
    const long = 'z'.repeat(80);
    const d = { ...SHORT_SITE, template: 'prime', services: [{ title: 'Fade', subtitle: '', description: '', icon: 'scissors', imageUrl: '', price: long, duration: long, category: long }], contact: { address: 'a, b, c', email: `${'e'.repeat(200)}@x.co` }, hours: [{ day: long, open: long, close: long }] } as unknown as WebsiteData;
    const html = renderSiteBundle(d, { siteBaseUrl: 'https://x.example.com' }).pages.map((p) => p.html).join('');
    expect(html).not.toContain('z'.repeat(41));
    expect(html).not.toContain('e'.repeat(121));
    expect(html).toContain('e'.repeat(120));
    expect(html).toContain('z'.repeat(24));
  });
});

describe("a barber's own hours equal to the shop's are not printed: sheet-only", () => {
  for (const t of TEMPLATES) for (const multi of [true, false]) it(`${t}${multi ? '' : ' single page'}`, () => {
    const hours = [{ day: 'Mon', open: '09:00', close: '17:00' }, { day: 'Sun', open: '', close: '', closed: true }];
    const d = { ...RICH_SITE, template: t, hours, staff: [{ name: 'Sam Fade', hours: hours.map((h) => ({ ...h })) }, { name: 'Al', hours: [{ day: 'Mon', open: '10:00', close: '14:00' }] }] } as WebsiteData;
    if (!multi) delete d.pages;
    const so = sheetOnlyDataPaths(d);
    expect(so).toContain('staff.0.hours.0.open');
    expect(so).toContain('staff.0.hours.1.day');
    const tapped = new Set(auditSite(d, t, 'proposed').flatMap((p) => Object.values(p.ids).filter((x) => p.previewHtml.includes(`data-edit="${x}"`))));
    for (const p of so) if (/^staff\.\d+\.hours\./.test(p)) expect(tapped.has(p), p).toBe(false);
    if (multi) { expect(so).not.toContain('staff.1.hours.0.open'); expect(tapped.has('staff.1.hours.0.open')).toBe(true); }
  });
});
