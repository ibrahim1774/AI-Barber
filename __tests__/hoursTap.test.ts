/** @jest-environment jsdom */
// A tap on the shop's working hours in the preview opens the Hours sheet; photos lose their dashed outline.
import fs from 'fs';
import path from 'path';
import { EDITOR_JS } from '@/lib/editorScript';
import { buildPreviewHtml, tagHoursRows, previewEditPaths } from '@/lib/editable';
import { renderSite, forRender } from '@/lib/render';
import { parsePreviewMessage } from '@/lib/previewBridge';
import type { TemplateId } from '@/web/types';
import { shop } from './pagesV2Fixture';

const added: [string, EventListenerOrEventListenerObject, unknown][] = [];
const realAdd = document.addEventListener.bind(document);
document.addEventListener = ((t: string, l: EventListenerOrEventListenerObject, o?: unknown) => { added.push([t, l, o]); realAdd(t, l, o as never); }) as typeof document.addEventListener;
afterEach(() => { for (const [t, l, o] of added.splice(0)) document.removeEventListener(t, l, o as never); });

function run(html: string) {
  document.body.innerHTML = /<body/i.test(html) ? new DOMParser().parseFromString(html, 'text/html').body.innerHTML : html;
  const posted: { type: string; [k: string]: unknown }[] = [];
  (window as unknown as { ReactNativeWebView: unknown }).ReactNativeWebView = { postMessage: (m: string) => posted.push(JSON.parse(m)) };
  delete (window as unknown as { __aibEditor?: boolean }).__aibEditor;
  // eslint-disable-next-line no-new-func
  new Function(EDITOR_JS)();
  return () => posted.filter((m) => !['ready', 'rects', 'scrollY'].includes(m.type));
}
const tap = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
const ATTR = 'data-ab-hours';
const designs: TemplateId[] = ['luxe', 'prime', 'euphoria'];
const pagesOf = (order: string[]) => ({ order, hidden: [] }) as never;
// [label, pages, page, does this design print the shop hours here]
const layouts: [string, unknown, { key: string } | undefined, (t: TemplateId) => boolean][] = [
  ['single page', undefined, undefined, (t) => t !== 'euphoria'],
  ['multi-page Home', pagesOf(['home', 'services', 'contact']), { key: 'home' }, (t) => t !== 'euphoria'],
  ['Hours page', pagesOf(['home', 'hours', 'contact']), { key: 'hours' }, () => true],
  ['Location page', pagesOf(['home', 'location', 'contact']), { key: 'location' }, () => true],
  ['Contact page', pagesOf(['home', 'hours', 'contact']), { key: 'contact' }, () => false],
];

describe.each(designs)('%s', (t) => {
  test.each(layouts)('%s: every shop hours row is tagged, a tap on a day or a time posts hours; the heading and other text keep the text box', async (_n, pages, page, prints) => {
    const d = await shop({ template: t, pages: pages as never });
    const html = buildPreviewHtml(d, true, null, page as never);
    const posted = run(html);
    const rows = Array.from(document.querySelectorAll(`[${ATTR}]`));
    if (!prints(t)) {
      expect(rows).toHaveLength(0);
      expect(document.querySelector('[data-edit^="hours."]')).toBeNull();
      return;
    }
    expect(rows).toHaveLength(7);
    expect(rows.length).toBe(document.querySelectorAll('[data-edit$=".day"][data-edit^="hours."]').length);
    tap(rows[2]);
    tap(rows[0].querySelector('[data-edit="hours.0.day"]')!);
    tap(rows[1].querySelector('[data-edit="hours.1.open"]')!);
    tap(rows[5].querySelector('[data-edit="hours.5.close"]')!);
    expect(posted()).toEqual([{ type: 'hours' }, { type: 'hours' }, { type: 'hours' }, { type: 'hours' }]);
    // Everything else is unchanged: a heading, the phone, the shop name still open the text box.
    const before = posted().length;
    const others = Array.from(document.querySelectorAll('[data-edit]')).filter((e) => !e.closest(`[${ATTR}]`) && !e.closest('a, nav, header, footer'));
    expect(others.length).toBeGreaterThan(0);
    for (const o of others) tap(o);
    const sent = posted().slice(before);
    expect(sent.every((m) => m.type === 'edit' || m.type === 'service')).toBe(true);
    expect(sent.filter((m) => m.type === 'edit').map((m) => m.path)).toEqual(others.filter((o) => !o.closest('[data-ab-service]')).map((o) => o.getAttribute('data-edit')));
  });

  test('the published site and the plain preview carry no hours marker', async () => {
    const d = await shop({ template: t, pages: pagesOf(['home', 'hours', 'contact']) });
    expect(renderSite(forRender(d))).not.toContain(ATTR);
    expect(buildPreviewHtml(d, false, null, { key: 'hours' })).not.toContain(ATTR);
    expect(buildPreviewHtml(d, false, null, undefined)).not.toContain(ATTR);
  });
});

test('tagHoursRows: only rows whose own text is hours.<i>.*, in each design markup', () => {
  const html =
    '<ul><li class="p-hours-row"><span data-edit="hours.0.day">Mon</span></li><li class="p-hours-row"><span data-edit="staff.0.hours.0.day">Mon</span></li></ul>' +
    '<div class="ab-row"><span data-edit="labels.x">x</span></div><div class="ab-row"><span data-edit="hours.3.open">9</span></div>';
  expect(tagHoursRows(html)).toBe(
    '<ul><li class="p-hours-row" data-ab-hours="1"><span data-edit="hours.0.day">Mon</span></li><li class="p-hours-row"><span data-edit="staff.0.hours.0.day">Mon</span></li></ul>' +
    '<div class="ab-row"><span data-edit="labels.x">x</span></div><div class="ab-row" data-ab-hours="1"><span data-edit="hours.3.open">9</span></div>',
  );
});

describe('bridge: {type:"hours"}', () => {
  test('accepted where the page prints shop hours, refused elsewhere', async () => {
    const d = await shop({ template: 'luxe', pages: pagesOf(['home', 'hours', 'contact']) });
    const raw = JSON.stringify({ type: 'hours' });
    const hoursPage = { key: 'hours' } as never;
    expect(parsePreviewMessage(raw, d, hoursPage, previewEditPaths(d, hoursPage))).toEqual({ type: 'hours' });
    expect(parsePreviewMessage(raw, d, hoursPage, ['hero.heading'])).toBeNull();
    expect(parsePreviewMessage(JSON.stringify({ type: 'hours', extra: 1 }), d, hoursPage, previewEditPaths(d, hoursPage))).toEqual({ type: 'hours' });
  });
});

describe('edit mode CSS', () => {
  const css = () => Array.from(document.querySelectorAll('style')).map((s) => s.textContent).join('');
  test('photos and image slots have no dashed outline; text and service cards keep theirs; hours rows get the card style', () => {
    run('<div data-edit-image="hero.imageUrl"></div><span data-edit="a.b">x</span>');
    const c = css();
    expect(c).not.toMatch(/\[data-edit-image\]\{[^}]*(outline|dashed)/);
    expect(c).toContain('[data-edit-image]{cursor:pointer;}');
    expect(c).toContain('[data-edit]{outline:1px dashed');
    expect(c).toContain('[data-ab-service]{outline:1px dashed');
    expect(c).toContain('[data-ab-hours]{outline:1px dashed');
    expect(c).toContain('[data-ab-hours] [data-edit]{outline:none;}');
    expect(EDITOR_JS).not.toContain('2px dashed');
  });
  test('a tap on a photo and its Change image chip still post image', () => {
    const posted = run('<div><img id="p" src="x.png" data-edit-image="hero.imageUrl"></div>');
    tap(document.getElementById('p')!);
    expect(posted()).toEqual([{ type: 'image', path: 'hero.imageUrl' }]);
    tap(document.querySelector('.aib-chip')!);
    expect(posted()[1]).toEqual({ type: 'image', path: 'hero.imageUrl' });
  });
  test('no other editor-only stylesheet outlines photos', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src/lib/editable.ts'), 'utf8');
    expect(src).not.toMatch(/data-edit-image[^\n]*(dashed|outline)/);
  });
});

describe('the Edit tab wires the hours tap', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src/app/(tabs)/edit.tsx'), 'utf8');
  const prev = fs.readFileSync(path.join(__dirname, '..', 'src/components/SitePreview.tsx'), 'utf8');
  test('SitePreview forwards it only when editable; edit.tsx opens the Hours sheet only with nothing else open and closes back to the preview', () => {
    expect(prev).toMatch(/case 'hours':\s*if \(editable\) onHours\?\.\(\);/);
    expect(src).toMatch(/onHours=\{onPreviewHours\}/);
    expect(src).toMatch(/onPreviewHours = useCallback\(\(\) => \{\s*if \(!canOpenAddService\(sheet, overlayRef\.current\)\) return;[\s\S]*?setHoursFromPreview\(true\);\s*setSheet\('hours'\);/);
    expect(src).toMatch(/<HoursSheet[\s\S]*?hoursFromPreview \? closeThen\(\(\) => setHoursFromPreview\(false\)\) : closeThen\(\(\) => setSheet\('sections'\)\)/);
    expect(src).toMatch(/setHoursFromPreview\(\(h\) => h && sheet === 'hours'\)/);
  });
});
