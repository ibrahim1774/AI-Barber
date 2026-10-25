import type { WebsiteData } from '@/web/types';
import { parsePreviewMessage, pageHrefsFor, shouldAllowPreviewRequest } from '@/lib/previewBridge';
import { pageForHref } from '@/lib/editable';
import { EDITOR_JS } from '@/lib/editorScript';
import { shop } from './pagesV2Fixture';

let data: WebsiteData;
beforeAll(async () => {
  data = await shop({ staff: [{ name: 'Sam', photo: '', bio: 'Sam has cut hair for ten years in Brooklyn.' }] as never });
});
const msg = (o: unknown) => JSON.stringify(o);

describe('nav message', () => {
  test('pageHrefsFor lists every page file plus /book and /shop', () => {
    const hrefs = pageHrefsFor(data);
    expect(hrefs).toEqual(expect.arrayContaining(['/', '/services/', '/book', '/shop']));
  });

  test('accepts only hrefs of this site', () => {
    expect(parsePreviewMessage(msg({ type: 'nav', href: '/services/' }), data)).toEqual({ type: 'nav', href: '/services/' });
    expect(parsePreviewMessage(msg({ type: 'nav', href: '/book' }), data)).toEqual({ type: 'nav', href: '/book' });
    expect(parsePreviewMessage(msg({ type: 'nav', href: '/shop' }), data)).toEqual({ type: 'nav', href: '/shop' });
  });

  test('rejects scripts, other sites, traversal, hidden pages and long hrefs', () => {
    for (const href of ['javascript:alert(1)', 'https://evil.com', '/services/../x', '//evil.com', '/nope/', 'x'.repeat(201), 42, null, undefined]) {
      expect(parsePreviewMessage(msg({ type: 'nav', href }), data)).toBeNull();
    }
    const hidden = { ...data, pages: { order: [], hidden: ['hours'] } } as WebsiteData;
    expect(pageHrefsFor(hidden)).not.toContain('/hours/');
    expect(parsePreviewMessage(msg({ type: 'nav', href: '/hours/' }), hidden)).toBeNull();
  });

  test('navigation is still blocked in the WebView', () => {
    expect(shouldAllowPreviewRequest({ url: 'https://x.com/', isTopFrame: true, navigationType: 'click' })).toBe(false);
    expect(shouldAllowPreviewRequest({ url: '/services/', isTopFrame: true, navigationType: 'click' })).toBe(false);
  });
});

describe('pageForHref', () => {
  test('maps the home, group and per-item pages', () => {
    expect(pageForHref(data, '/')).toEqual({ key: 'home' });
    expect(pageForHref(data, '/services/')).toEqual({ key: 'services' });
    const svc = pageHrefsFor(data).find((h) => /^\/services\/[^/]+\/$/.test(h));
    if (svc) expect(pageForHref(data, svc)).toMatchObject({ key: 'services', index: expect.any(Number) });
    const team = pageHrefsFor(data).find((h) => /^\/team\/[^/]+\/$/.test(h));
    if (team) expect(pageForHref(data, team)).toMatchObject({ key: 'team', index: expect.any(Number) });
  });
  test('null for unknown, book and shop', () => {
    expect(pageForHref(data, '/nope/')).toBeNull();
    expect(pageForHref(data, '/book')).toBeNull();
    expect(pageForHref(data, 'javascript:1')).toBeNull();
  });
});

test('the editor script keeps the menu branches', () => {
  for (const s of ['ab-nav-toggle', 'ab-burger', 'ab-nav-list', 'scrollIntoView', 'pointerdown', 'type: \'nav\'']) {
    expect(EDITOR_JS).toContain(s);
  }
});
