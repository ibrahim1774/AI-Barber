/** @jest-environment jsdom */
// The real EDITOR_JS on the real editable preview of each design: where a tap on a service card goes.
import { EDITOR_JS } from '@/lib/editorScript';
import { buildPreviewHtml } from '@/lib/editable';
import type { TemplateId, WebsiteData } from '@/web/types';
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

const designs: TemplateId[] = ['luxe', 'prime', 'euphoria'];
const MULTI = { order: ['home', 'services', 'about', 'contact'], hidden: [] } as never;
const withDetails = (d: WebsiteData): WebsiteData => ({
  ...d,
  services: d.services.map((s) => ({ ...s, description: 'Desc text', subtitle: 'Sub' })) as WebsiteData['services'],
});

const layouts: [string, Partial<WebsiteData>, { key: 'home' | 'services'; index?: number } | undefined][] = [
  ['single page', { pages: undefined }, undefined],
  ['multi-page Home', { pages: MULTI }, { key: 'home' }],
  ['multi-page Services page', { pages: MULTI }, { key: 'services' }],
];

describe.each(designs)('%s', (t) => {
  test.each(layouts)('%s: a tap on a card (its box, title, price, description) posts the service; headings and Add keep their own', async (_n, extra, page) => {
    const d = withDetails(await shop({ template: t, ...extra }));
    const posted = run(buildPreviewHtml(d, true, null, page));
    const cards = Array.from(document.querySelectorAll('[data-ab-service]'));
    expect(cards.map((c) => c.getAttribute('data-ab-service'))).toEqual(['0', '1', '2']);
    // The box itself (padding / gap), then each text inside it.
    tap(cards[1]);
    expect(posted()).toEqual([{ type: 'service', index: 1 }]);
    tap(cards[2].querySelector('[data-edit="services.2.title"]')!);
    tap(cards[0].querySelector('[data-edit="services.0.price"]')!);
    tap(cards[0].querySelector('[data-edit="services.0.description"]')!);
    expect(posted().slice(1)).toEqual([{ type: 'service', index: 2 }, { type: 'service', index: 0 }, { type: 'service', index: 0 }]);
    // On the Services page the title is a link; its tap does not navigate and still opens the sheet.
    // Other taps are unchanged.
    const before = posted().length;
    const heading = document.querySelector('#services [data-edit^="labels."]') ?? document.querySelector('h1 [data-edit^="labels."]');
    tap(heading!);
    expect(posted().slice(before)).toEqual([{ type: 'edit', path: heading!.getAttribute('data-edit') }]);
    tap(document.querySelector('[data-ab-add-service]')!);
    expect(posted().slice(before + 1)).toEqual([{ type: 'addService' }]);
  });

  test('the menu keeps its own taps', async () => {
    const d = withDetails(await shop({ template: t, pages: MULTI }));
    const posted = run(buildPreviewHtml(d, true, null, { key: 'services' }));
    const nav = document.querySelector('.ab-nav-list a[href="/"]')!;
    tap(nav);
    expect(posted()).toEqual([{ type: 'nav', href: '/' }]);
  });

  test('a service detail page keeps text editing on its title; its list of other services is not a card', async () => {
    const d = withDetails(await shop({ template: t, pages: MULTI }));
    const posted = run(buildPreviewHtml(d, true, null, { key: 'services', index: 0 }));
    expect(document.querySelector('[data-ab-service]')).toBeNull();
    tap(document.querySelector('h1 [data-edit="services.0.title"]')!);
    expect(posted()).toEqual([{ type: 'edit', path: 'services.0.title' }]);
  });
});

test('a photo or a labelled button inside a card keeps its own handling', () => {
  const posted = run(
    '<section><div class="eu-service-row" data-ab-service="1"><img id="p" src="x.png" data-edit-image="services.1.imageUrl"><span data-edit="services.1.title">A</span>' +
    '<a id="b" href="/book"><span data-edit="labels.pgBookCta">Book</span></a><a id="t" href="/s/"><span data-edit="services.1.title">A</span></a></div></section>',
  );
  tap(document.getElementById('p')!);
  expect(posted()).toEqual([{ type: 'image', path: 'services.1.imageUrl' }]);
  tap(document.getElementById('b')!);
  expect(posted()[1]).toEqual({ type: 'edit', path: 'labels.pgBookCta' });
  tap(document.getElementById('t')!);
  expect(posted()[2]).toEqual({ type: 'service', index: 1 });
});

test('the card outline replaces the per-word outlines inside it (edit mode only: the style is injected by the editor script)', () => {
  run('<div data-ab-service="0"><span data-edit="services.0.title">A</span></div>');
  const css = Array.from(document.querySelectorAll('style')).map((s) => s.textContent).join('');
  expect(css).toContain('[data-ab-service]{outline:1px dashed');
  expect(css).toContain('[data-ab-service] [data-edit]{outline:none;}');
});
