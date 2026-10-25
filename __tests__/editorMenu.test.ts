/** @jest-environment jsdom */
// The real EDITOR_JS on a menu like the renderer's: burger toggles, entries navigate, long press edits.
import { EDITOR_JS } from '@/lib/editorScript';

const added: [string, EventListenerOrEventListenerObject, unknown][] = [];
const realAdd = document.addEventListener.bind(document);
document.addEventListener = ((t: string, l: EventListenerOrEventListenerObject, o?: unknown) => { added.push([t, l, o]); realAdd(t, l, o as never); }) as typeof document.addEventListener;
afterEach(() => { for (const [t, l, o] of added.splice(0)) document.removeEventListener(t, l, o as never); jest.useRealTimers(); });

const MENU =
  '<nav class="ab-nav"><input type="checkbox" id="ab-nav-toggle" class="ab-nav-toggle"><label for="ab-nav-toggle" class="ab-burger"><i></i></label>' +
  '<ul class="ab-nav-list"><li><a id="svc" href="/services/"><span data-edit="labels.pgNavServices">Services</span></a></li>' +
  '<li><a id="bk" href="/book"><span data-edit="labels.pgNavBook">Book</span></a></li></ul></nav><section id="about">x</section><a id="jump" href="#about">Go</a>';

function run(html: string) {
  document.body.innerHTML = html;
  const posted: unknown[] = [];
  (window as unknown as { ReactNativeWebView: unknown }).ReactNativeWebView = { postMessage: (m: string) => posted.push(JSON.parse(m)) };
  delete (window as unknown as { __aibEditor?: boolean }).__aibEditor;
  // eslint-disable-next-line no-new-func
  new Function(EDITOR_JS)();
  return posted;
}
const of = (p: unknown[], type: string) => p.filter((m) => (m as { type: string }).type === type);
const toggle = () => document.getElementById('ab-nav-toggle') as HTMLInputElement;
const ptr = (el: Element, type: string, x = 5, y = 5) => el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y }));

test('tapping the burger opens and closes the menu', () => {
  run(MENU);
  const burger = document.querySelector('.ab-burger') as HTMLElement;
  burger.click();
  expect(toggle().checked).toBe(true);
  burger.click();
  expect(toggle().checked).toBe(false);
});

test('a tap on an entry posts nav (not edit) and closes the menu', () => {
  const posted = run(MENU);
  toggle().checked = true;
  document.querySelector('[data-edit="labels.pgNavServices"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  expect(of(posted, 'nav')).toEqual([{ type: 'nav', href: '/services/' }]);
  expect(of(posted, 'edit')).toEqual([]);
  expect(toggle().checked).toBe(false);
});

test('a long press on an entry edits its label instead of navigating', () => {
  jest.useFakeTimers();
  const posted = run(MENU);
  const word = document.querySelector('[data-edit="labels.pgNavServices"]')!;
  ptr(word, 'pointerdown');
  jest.advanceTimersByTime(700);
  ptr(word, 'pointerup');
  word.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  expect(of(posted, 'edit')).toEqual([{ type: 'edit', path: 'labels.pgNavServices' }]);
  expect(of(posted, 'nav')).toEqual([]);
});

test('a long press that moved is a tap', () => {
  jest.useFakeTimers();
  const posted = run(MENU);
  const word = document.querySelector('[data-edit="labels.pgNavServices"]')!;
  ptr(word, 'pointerdown', 5, 5);
  ptr(word, 'pointermove', 60, 5);
  jest.advanceTimersByTime(700);
  ptr(word, 'pointerup', 60, 5);
  word.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  expect(of(posted, 'nav')).toHaveLength(1);
});

test('in-page anchors scroll and post nothing', () => {
  const posted = run(MENU);
  const target = document.getElementById('about')!;
  const spy = jest.fn();
  target.scrollIntoView = spy;
  document.getElementById('jump')!.click();
  expect(spy).toHaveBeenCalled();
  expect(posted.filter((m) => ['nav', 'edit'].includes((m as { type: string }).type))).toEqual([]);
});
