// Editable everywhere (2026-10-24): on every page of every design, every visible word is either editable in the preview
// or on the short allow-list below. "Editable" means what the iOS app means by it: the value was wrapped in the app's
// invisible markers before rendering and the marker pair survived into a text node (tests/render/helpers/editAudit.ts
// repeats the app's markData / prepareEditableHtml). Markers never reach published output: published HTML is rendered
// from the plain data and is asserted free of them here.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { TemplateId, WebsiteData } from '../../types';
import { renderSiteBundle } from '../../lib/render/site';
import { defaultLabel, visiblePageLabelKeys, visibleLabelKeys, type LabelKey } from '../../lib/render/labels';
import { buildPageSet } from '../../lib/render/pages';
import { visibleCopyKeys } from '../../lib/render/guides';
import { auditSite, type PageAudit } from './helpers/editAudit';
import { ALLOW, allowedBy } from './helpers/editAllow';
import { EXTERNAL_SITE, NAILS_SITE, RICH_SITE, SHORT_SITE, SPARSE_SITE } from './helpers/richSite';

beforeAll(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2031-06-01T12:00:00Z')); });
afterAll(() => { vi.useRealTimers(); });

const TEMPLATES: TemplateId[] = ['luxe', 'prime', 'euphoria'];
const SITES: [string, WebsiteData, number][] = [['rich', RICH_SITE, 15], ['short', SHORT_SITE, 15], ['external links', EXTERNAL_SITE, 15], ['nails', NAILS_SITE, 15], ['sparse (every fallback wording)', SPARSE_SITE, 2]];

const used = new Set<string>();

function uncovered(audits: PageAudit[], d: WebsiteData): string[] {
  const out: string[] = [];
  for (const p of audits) for (const n of p.nodes) {
    if (n.edit) continue;
    const a = allowedBy(n.text, d);
    if (a) { used.add(a.name); continue; }
    out.push(`${p.page}: "${n.text}"`);
  }
  return out;
}

const audits = new Map<string, PageAudit[]>();
const auditOf = (name: string, d: WebsiteData, t: TemplateId): PageAudit[] => {
  const k = `${name}/${t}`;
  if (!audits.has(k)) audits.set(k, auditSite(d, t, 'proposed'));
  return audits.get(k)!;
};

const noAnchors = (h: string): string => h.replace(/<a\b[^>]*>/g, '').replace(/<\/a>/g, '').toLowerCase();

describe.each(SITES)('%s site', (name, site, minPages) => {
  describe.each(TEMPLATES)('%s', (t) => {
    const d = { ...site, template: t } as WebsiteData;

    it('every visible text on every page is editable or on the allow-list', () => {
      const a = auditOf(name, d, t);
      expect(a.length).toBeGreaterThanOrEqual(minPages);
      expect(uncovered(a, d)).toEqual([]);
    });

    it('the preview is the published page with tap targets added: stripping the markers gives the published HTML', () => {
      for (const p of auditOf(name, d, t)) {
        // A library text block that holds links ("use the Book now link") is previewed as the barber's own plain words
        // (the app marks it as an override), so for those pages compare without the links and their label case.
        const copy = Object.values(p.ids).some((x) => x.startsWith('copy.'));
        const [x, y] = copy ? [noAnchors(p.plainHtml), noAnchors(p.strippedHtml)] : [p.plainHtml, p.strippedHtml];
        expect(y, `${t} ${p.page}`).toBe(x);
      }
    });

    it('every label and library text the app lists for a page is on that page', () => {
      const a = auditOf(name, d, t);
      const set = buildPageSet(d, {});
      const present = (pred: (p: PageAudit) => boolean): Set<string> => new Set(a.filter(pred).flatMap((p) => Object.values(p.ids).filter((path) => p.previewHtml.includes(`data-edit="${path}"`))));
      for (const key of new Set(set.files.map((f) => f.key))) {
        const on = present((p) => p.ref.key === key);
        for (const k of visiblePageLabelKeys(d, key as never)) {
          // Listed for the app's "all texts" sheet, not printed in the body: an optional line with no wording yet (default
          // '', e.g. the Prime booking note: it prints once written), and the place name on Location (it names the page title only).
          if (defaultLabel(k as LabelKey, undefined, d) === '' || (k === 'pgPlace' && key === 'location')) continue;
          expect(on.has(`labels.${k}`), `${t} ${key}: label ${k} is listed but not printed`).toBe(true);
        }
      }
      for (const p of a) {
        const on = present((q) => q === p);
        const file = set.files.find((f) => f.path === p.page)!;
        for (const k of visibleCopyKeys(d, file, set.services.map((c) => c.index))) expect(on.has(`copy.${k}`), `${t} ${p.page}: copy ${k} is listed but not printed`).toBe(true);
      }
    });

    it('published HTML has no editor markers and no tap targets', () => {
      for (const f of renderSiteBundle(d, { siteBaseUrl: 'https://fresh.example.com' }).pages) {
        expect(f.html, f.path).not.toContain('⁣');
        expect(f.html, f.path).not.toContain('data-edit');
      }
    });
  });
});

describe('allow-list', () => {
  it('has no dead entries', () => {
    for (const a of ALLOW) expect(used.has(a.name), `allow-list entry "${a.name}" matched nothing`).toBe(true);
  });
  it('the home page of every design lists its single-page labels (the app\'s "all texts")', () => {
    for (const t of TEMPLATES) expect(visibleLabelKeys({ ...RICH_SITE, template: t } as WebsiteData).length).toBeGreaterThan(10);
  });
});
