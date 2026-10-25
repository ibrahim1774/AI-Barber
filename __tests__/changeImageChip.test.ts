/** @jest-environment jsdom */
// The "Change image" chip is page DOM injected by the preview-only EDITOR_JS (never the published site).
import { EDITOR_JS } from '@/lib/editorScript';
import { parsePreviewMessage, tourPillPath } from '@/lib/previewBridge';
import { TOURS } from '@/components/tutorial/tours';

const added: [string, EventListenerOrEventListenerObject, unknown][] = [];
const realAdd = document.addEventListener.bind(document);
document.addEventListener = ((t: string, l: EventListenerOrEventListenerObject, o?: unknown) => { added.push([t, l, o]); realAdd(t, l, o as never); }) as typeof document.addEventListener;

const box = (left: number, top: number, width: number, height: number) =>
  ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect;
const photoBox = new Map<string, DOMRect>();
const realRect = Element.prototype.getBoundingClientRect;
beforeAll(() => {
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const p = this.getAttribute('data-edit-image');
    if (p && photoBox.has(p)) return photoBox.get(p)!;
    if (this.classList.contains('aib-chip')) return box(6, 320, 100, 19);
    return box(0, 0, 0, 0);
  };
});
afterAll(() => { Element.prototype.getBoundingClientRect = realRect; });
afterEach(() => { for (const [t, l, o] of added.splice(0)) document.removeEventListener(t, l, o as never); photoBox.clear(); jest.useRealTimers(); });

function run(html: string) {
  document.body.innerHTML = html;
  const posted: any[] = [];
  (window as any).ReactNativeWebView = { postMessage: (m: string) => posted.push(JSON.parse(m)) };
  delete (window as any).__aibEditor;
  // eslint-disable-next-line no-new-func
  new Function(EDITOR_JS)();
  return posted;
}
const hosts = () => Array.from(document.querySelectorAll<HTMLElement>('.aib-chip-host'));

const PAGE = '<div id="wrap"><img id="hero" data-edit-image="hero.imageUrl" src="x.jpg"><h1 data-edit="hero.title">Title</h1><img id="g" data-edit-image="gallery.2" src="y.jpg"></div>';

describe('Change image chip in the page', () => {
  test('one chip per photo, next to it, camera icon before the text, bottom-left inside the photo box', () => {
    photoBox.set('hero.imageUrl', box(0, 40, 390, 300));
    photoBox.set('gallery.2', box(10, 400, 30, 30)); // too small to carry a chip
    run(PAGE);
    expect(hosts()).toHaveLength(2);
    const hero = document.getElementById('hero')!.nextElementSibling as HTMLElement;
    expect(hero.className).toBe('aib-chip-host');
    expect(hero.getAttribute('data-aib-chip')).toBe('hero.imageUrl');
    const chip = hero.querySelector('.aib-chip')!;
    expect(chip.firstElementChild!.tagName.toLowerCase()).toBe('svg');
    expect(chip.querySelector('svg')!.getAttribute('width')).toBe('11');
    expect(chip.textContent).toBe('Change image');
    expect(chip.getAttribute('role')).toBe('button');
    // Anchored at the photo's bottom-left (6px inset), in document coordinates.
    expect(hero.style.left).toBe('6px');
    expect(hero.style.top).toBe('334px');
    expect(hosts()[1].style.display).toBe('none');
  });

  test('styles: static look, no motion, pointer events only on the chip, 44px+ invisible tap area', () => {
    run(PAGE);
    const css = Array.from(document.querySelectorAll('style')).map((s) => s.textContent).join('');
    expect(css).toMatch(/\.aib-chip-host\{[^}]*pointer-events:none/);
    expect(css).toMatch(/\.aib-chip\{[^}]*pointer-events:auto/);
    expect(css).toMatch(/\.aib-chip::before\{content:"";position:absolute;top:-16px;right:-20px;bottom:-16px;left:-14px/);
    expect(css).toMatch(/font:600 11px/);
    expect(css).not.toMatch(/transition|animation|:hover/);
  });

  test('tapping the chip posts the image message, not a text edit; taps on text still edit', () => {
    photoBox.set('hero.imageUrl', box(0, 40, 390, 300));
    const posted = run(PAGE);
    hosts()[0].querySelector<HTMLElement>('.aib-chip span')!.click();
    expect(posted.filter((m) => m.type === 'image')).toEqual([{ type: 'image', path: 'hero.imageUrl' }]);
    document.querySelector<HTMLElement>('[data-edit]')!.click();
    expect(posted.filter((m) => m.type === 'edit')).toEqual([{ type: 'edit', path: 'hero.title' }]);
  });

  test('a chip inside a link still opens the photo, not the link', () => {
    photoBox.set('hero.imageUrl', box(0, 40, 390, 300));
    const posted = run('<a href="/book"><img data-edit-image="hero.imageUrl" src="x.jpg"></a>');
    hosts()[0].querySelector<HTMLElement>('.aib-chip')!.click();
    expect(posted.filter((m) => m.type === 'image')).toEqual([{ type: 'image', path: 'hero.imageUrl' }]);
  });

  test('positions relative to a positioned container', () => {
    photoBox.set('hero.imageUrl', box(20, 100, 300, 200));
    run('<div id="p" style="position:relative"><img data-edit-image="hero.imageUrl" src="x.jpg"></div>');
    const p = document.getElementById('p')!;
    p.getBoundingClientRect = () => box(10, 90, 320, 300);
    Object.defineProperty(document.querySelector('.aib-chip-host'), 'offsetParent', { value: p });
    (window as any).__aibSetSamples([], ''); // re-places the chips
    const h = hosts()[0];
    expect(h.style.left).toBe('16px'); // 20 + 6 - 10
    expect(h.style.top).toBe('204px'); // 100 + 200 - 6 - 90
  });

  test('sample note: DOM text above the chip, only for sample photos, removable', () => {
    photoBox.set('hero.imageUrl', box(0, 40, 390, 300));
    photoBox.set('gallery.2', box(0, 400, 390, 300));
    run(PAGE);
    (window as any).__aibSetSamples(['hero.imageUrl'], 'Sample photo - replace with yours');
    const [a, b] = hosts();
    expect(a.firstElementChild!.className).toBe('aib-chip-note');
    expect(a.firstElementChild!.textContent).toBe('Sample photo - replace with yours');
    expect(a.lastElementChild!.className).toBe('aib-chip');
    expect(b.querySelector('.aib-chip-note')).toBeNull();
    (window as any).__aibSetSamples([], 'x');
    expect(a.querySelector('.aib-chip-note')).toBeNull();
  });

  test('chips do not move with scrolling: no scroll-driven placement or rect stream', () => {
    jest.useFakeTimers();
    photoBox.set('hero.imageUrl', box(0, 40, 390, 300));
    const posted = run(PAGE);
    const before = hosts()[0].style.top;
    window.dispatchEvent(new Event('scroll'));
    expect(hosts()[0].style.top).toBe(before);
    expect(posted.some((m) => m.type === 'scrolling')).toBe(false);
    expect(EDITOR_JS).not.toContain('liveTimer');
    jest.advanceTimersByTime(300);
    expect(posted.some((m) => m.type === 'scrolling')).toBe(false);
  });

  test('rects report the on-screen chips only (for the Edit tour)', () => {
    jest.useFakeTimers();
    photoBox.set('hero.imageUrl', box(0, 40, 390, 300));
    const posted = run(PAGE);
    jest.advanceTimersByTime(300);
    expect(posted.filter((m) => m.type === 'rects').pop()).toEqual({ type: 'rects', items: [{ path: 'hero.imageUrl', x: 6, y: 320, w: 100, h: 19 }] });
  });

  test('the script stays plain ASCII and parses', () => {
    expect(() => new Function(EDITOR_JS)).not.toThrow();
    expect(EDITOR_JS).toMatch(/^[\x00-\x7f]*$/);
  });

  test('preview only: the chip exists nowhere but the editor script', () => {
    const fs = require('fs'); const path = require('path');
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e: any) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const hits = walk(path.join(__dirname, '../src')).filter((f) => /\.(ts|tsx|js)$/.test(f) && fs.readFileSync(f, 'utf8').includes('aib-chip'));
    expect(hits.map((f) => path.basename(f))).toEqual(['editorScript.ts']);
  });
});

describe('bridge and tour', () => {
  test('the tour points at the hero chip, else the first', () => {
    const r = [{ path: 'hero.imageUrl', x: 6, y: 300, w: 100, h: 19 }, { path: 'gallery.2', x: 6, y: 500, w: 100, h: 19 }];
    expect(tourPillPath(r)).toBe('hero.imageUrl');
    expect(tourPillPath(r.slice(1))).toBe('gallery.2');
    expect(tourPillPath([])).toBeNull();
  });

  test('"scrolling" is no longer a bridge message; image/ready still are', () => {
    const data: any = { hero: { imageUrl: 'a' }, gallery: [] };
    expect(parsePreviewMessage(JSON.stringify({ type: 'scrolling' }), data)).toBeNull();
    expect(parsePreviewMessage(JSON.stringify({ type: 'ready' }), data)).toEqual({ type: 'ready' });
  });

  test('the Edit tour keeps its photo step on edit.changeImage', () => {
    expect(TOURS.edit.steps.map((s) => s.target)).toEqual(['edit.publish', 'edit.sections', 'edit.pages', 'edit.text', 'edit.changeImage']);
  });
});
