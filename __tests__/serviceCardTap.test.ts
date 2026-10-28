// A tap on a service card in the preview opens the Services sheet at that service: the editor-only card marker, the bridge
// message, the guard and the Bookings position mapping.
import fs from 'fs';
import path from 'path';
import type { TemplateId, WebsiteData } from '@/web/types';
import { renderSite, forRender } from '@/lib/render';
import { buildPreviewHtml, previewEditPaths, tagServiceCards } from '@/lib/editable';
import { parsePreviewMessage } from '@/lib/previewBridge';
import { keepServicesFocus, serviceFocusFor } from '@/lib/addServiceGuard';
import { serviceAtSitePosition } from '@/lib/setup/servicesMap';
import { shop } from './pagesV2Fixture';

const ATTR = 'data-ab-service';
const designs: TemplateId[] = ['luxe', 'prime', 'euphoria'];
const MULTI = { order: ['home', 'services', 'about', 'contact'], hidden: [] } as never;
const msg = (o: unknown) => JSON.stringify(o);
const rich = (d: WebsiteData): WebsiteData => ({
  ...d,
  services: d.services.map((s) => ({ ...s, subtitle: 'Sub', description: 'Desc text', category: 'Cuts' })) as WebsiteData['services'],
});

/** Every services.<i>.title span, with the card index its nearest tagged ancestor names (null when it has none). */
function titleCards(whole: string): { i: number; card: number | null }[] {
  // The footer's list of service links is not a card list.
  const foot = whole.indexOf('<footer');
  const html = foot >= 0 ? whole.slice(0, foot) : whole;
  const out: { i: number; card: number | null }[] = [];
  const re = /data-edit="services\.(\d+)\.title"/g;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const before = html.slice(0, m.index);
    const tag = /data-ab-service="(\d+)"/g;
    let last: RegExpExecArray | null = null;
    for (let t = tag.exec(before); t; t = tag.exec(before)) last = t;
    // The card must still be open: nothing between its tag and the span closes the card's section.
    const open = last && !before.slice(last.index).includes('</section>');
    out.push({ i: Number(m[1]), card: open && last ? Number(last[1]) : null });
  }
  return out;
}

describe('tagServiceCards: every service card in every design and layout', () => {
  test.each(designs)('%s single page: each service title sits in a card tagged with its own index', async (t) => {
    const d = rich(await shop({ template: t, pages: undefined }));
    const pairs = titleCards(buildPreviewHtml(d, true));
    expect(pairs.map((p) => p.i)).toEqual([0, 1, 2]);
    for (const p of pairs) expect(p.card).toBe(p.i);
  });

  test.each(designs)('%s multi-page: Home cards and the Services page cards are tagged; a service detail page is not', async (t) => {
    const d = rich(await shop({ template: t, pages: MULTI }));
    for (const page of [{ key: 'home' as const }, { key: 'services' as const }]) {
      const html = buildPreviewHtml(d, true, null, page);
      const pairs = titleCards(html);
      expect(pairs.length).toBeGreaterThanOrEqual(3);
      for (const p of pairs) expect(p.card).toBe(p.i);
      expect(html.split(`${ATTR}="`)).toHaveLength(4);
    }
    expect(buildPreviewHtml(d, true, null, { key: 'services', index: 0 })).not.toContain(ATTR);
  });

  test.each(designs)('%s: a service with no price or details is still a tagged card', async (t) => {
    const base = await shop({ template: t, pages: undefined });
    const d = { ...base, services: [{ title: 'Haircut' }, { title: 'Skin fade' }] as WebsiteData['services'] };
    expect(titleCards(buildPreviewHtml(d, true)).map((p) => p.card)).toEqual([0, 1]);
  });

  test.each(designs)('%s: editor-only. Not in the plain preview, the published render, or a marker-free page', async (t) => {
    for (const pages of [undefined, MULTI]) {
      const d = rich(await shop({ template: t, pages }));
      expect(buildPreviewHtml(d, false)).not.toContain(ATTR);
      expect(buildPreviewHtml(d, false, null, { key: 'services' })).not.toContain(ATTR);
    }
    const d = rich(await shop({ template: t, pages: undefined }));
    expect(renderSite(forRender(d))).not.toContain(ATTR);
  });

  test('a Team-style card with no services text is left alone, and only the first path decides', () => {
    const html = '<section><div class="ab-card"><span data-edit="staff.0.name">Sam</span></div><div class="ab-card"><span data-edit="services.4.title">X</span></div></section>';
    expect(tagServiceCards(html)).toBe('<section><div class="ab-card"><span data-edit="staff.0.name">Sam</span></div><div class="ab-card" data-ab-service="4"><span data-edit="services.4.title">X</span></div></section>');
  });

  test('the last card does not borrow a service path from a later section', () => {
    const html = '<section><div class="eu-service-row"><span data-edit="labels.x">x</span></div></section><section><span data-edit="services.1.title">Y</span></section>';
    expect(tagServiceCards(html)).toBe(html);
  });
});

describe('bridge: {type:"service", index}', () => {
  test('accepts an index the page names; rejects everything else', async () => {
    const d = await shop({ pages: undefined });
    expect(parsePreviewMessage(msg({ type: 'service', index: 0 }), d)).toEqual({ type: 'service', index: 0 });
    expect(parsePreviewMessage(msg({ type: 'service', index: 2 }), d)).toEqual({ type: 'service', index: 2 });
    for (const index of [3, 99, -1, 1.5, '0', null, NaN, Infinity, [0], {}, true, undefined]) {
      expect(parsePreviewMessage(msg({ type: 'service', index }), d)).toBeNull();
    }
    expect(parsePreviewMessage(msg({ type: 'service' }), d)).toBeNull();
    expect(parsePreviewMessage(msg({ type: 'Service', index: 0 }), d)).toBeNull();
  });

  test('uses the per-page whitelist: a service detail page names its own service and the others it lists', async () => {
    const d = await shop({ pages: MULTI });
    const paths = previewEditPaths(d, { key: 'services', index: 0 });
    expect(paths.some((p) => p.startsWith('services.0.'))).toBe(true);
    expect(parsePreviewMessage(msg({ type: 'service', index: 1 }), d, { key: 'services', index: 0 }, paths)).toEqual({ type: 'service', index: 1 });
    expect(parsePreviewMessage(msg({ type: 'service', index: 0 }), d, { key: 'home' }, ['hero.heading'])).toBeNull();
  });
});

describe('opening the sheet', () => {
  const three = [{}, {}, {}];
  test('serviceFocusFor: only with nothing else open, and only for a service that exists', () => {
    expect(serviceFocusFor(null, null, three, 1)).toBe(1);
    expect(serviceFocusFor('hours', null, three, 1)).toBeNull();
    expect(serviceFocusFor(null, 'guide', three, 1)).toBeNull();
    expect(serviceFocusFor('services', null, three, 1)).toBeNull();
    expect(serviceFocusFor(null, null, three, 3)).toBeNull();
    expect(serviceFocusFor(null, null, three, -1)).toBeNull();
    expect(serviceFocusFor(null, null, undefined, 0)).toBeNull();
  });
  test('keepServicesFocus: ends with the Services sheet', () => {
    expect(keepServicesFocus(2, 'services')).toBe(2);
    expect(keepServicesFocus(2, null)).toBeNull();
    expect(keepServicesFocus(2, 'sections')).toBeNull();
    expect(keepServicesFocus(null, 'services')).toBeNull();
  });
  test('the Edit tab wires the preview tap to the right sheet for both stores', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src/app/(tabs)/edit.tsx'), 'utf8');
    expect(src).toMatch(/onService=\{onPreviewService\}/);
    expect(src).toMatch(/serviceFocusFor\(sheet, overlayRef\.current, shownRef\.current\?\.services, index\)/);
    expect(src).toMatch(/setServicesFocus\(at\);\s*setSheet\('services'\)/);
    expect(src).toMatch(/keepServicesFocus\(/);
    // One Services sheet per store: the Bookings one (shop exists) and the site-data one both get the focus.
    expect(src).toMatch(/<BookingsServicesSheet[\s\S]*?focus=\{servicesFocus != null \? \{ index: servicesFocus, title: shown\.services\?\.\[servicesFocus\]\?\.title/);
    expect(src).toMatch(/<ServicesSheet[\s\S]*?focusIndex=\{servicesFocus\}/);
  });
});

describe('serviceAtSitePosition (Bookings: the site list is the show-on-site rows in sort order)', () => {
  const row = (id: string, name: string, sort: number, showOnSite = true) => ({ id, name, sort, showOnSite }) as never;
  const list = [row('a', 'Haircut', 0), row('h', 'Hidden one', 1, false), row('b', 'Skin fade', 2), row('c', 'Beard trim', 3)];
  test('position maps past hidden rows', () => {
    expect(serviceAtSitePosition(list, 0, 'Haircut')?.id).toBe('a');
    expect(serviceAtSitePosition(list, 1, 'Skin fade')?.id).toBe('b');
    expect(serviceAtSitePosition(list, 2, 'Beard trim')?.id).toBe('c');
  });
  test('sorted by sort, not by array order', () => {
    expect(serviceAtSitePosition([list[3], list[2], list[0], list[1]], 1, 'Skin fade')?.id).toBe('b');
  });
  test('the title wins when the lists drifted; position is the fallback without one', () => {
    expect(serviceAtSitePosition(list, 0, ' skin FADE ')?.id).toBe('b');
    expect(serviceAtSitePosition(list, 1)?.id).toBe('b');
    expect(serviceAtSitePosition(list, 0, 'Hidden one')?.id).toBe('h');
  });
  test('nothing found -> null (the sheet shows the list)', () => {
    expect(serviceAtSitePosition(list, 9, 'Nope')).toBeNull();
    expect(serviceAtSitePosition(list, 9)).toBeNull();
    expect(serviceAtSitePosition([], 0, 'Haircut')).toBeNull();
  });
});
