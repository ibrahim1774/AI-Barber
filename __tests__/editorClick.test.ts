/** @jest-environment jsdom */
// The real EDITOR_JS click handler on the "Book with Sam" button: a link holding two editable texts.
import { EDITOR_JS } from '@/lib/editorScript';

const added: [string, EventListenerOrEventListenerObject, unknown][] = [];
const realAdd = document.addEventListener.bind(document);
document.addEventListener = ((t: string, l: EventListenerOrEventListenerObject, o?: unknown) => { added.push([t, l, o]); realAdd(t, l, o as never); }) as typeof document.addEventListener;
afterEach(() => { for (const [t, l, o] of added.splice(0)) document.removeEventListener(t, l, o as never); });

function run(html: string) {
  document.body.innerHTML = html;
  const posted: unknown[] = [];
  (window as unknown as { ReactNativeWebView: unknown }).ReactNativeWebView = { postMessage: (m: string) => posted.push(JSON.parse(m)) };
  delete (window as unknown as { __aibEditor?: boolean }).__aibEditor;
  // eslint-disable-next-line no-new-func
  new Function(EDITOR_JS)();
  return posted;
}
const edits = (p: unknown[]) => p.filter((m) => (m as { type: string }).type === 'edit');

test('tap on the padding of Book with Sam opens the first label; a tap on a word opens that word', () => {
  const posted = run('<a id="b" href="/book"><span data-edit="labels.teamBookWith">Book with</span> <span data-edit="staff.0.name">Sam</span></a>');
  document.getElementById('b')!.click();
  expect(edits(posted)).toEqual([{ type: 'edit', path: 'labels.teamBookWith' }]);
  document.querySelector('[data-edit="staff.0.name"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  expect(edits(posted)[1]).toEqual({ type: 'edit', path: 'staff.0.name' });
});

test('a single editable text in a link still opens on the padding', () => {
  const posted = run('<a id="b" href="/x"><span data-edit="labels.pgBookCta">Book</span></a>');
  document.getElementById('b')!.click();
  expect(edits(posted)).toEqual([{ type: 'edit', path: 'labels.pgBookCta' }]);
});
