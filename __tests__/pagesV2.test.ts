// Pages v2 in the app (plan 2026-10-24, phase D): grouping, search, place row, disabled reasons, defaults for new
// sites only, guide pages through extraPages.on, immutable copy edits, sections, page heroes.
import { PAGE_KEYS, extraPageRows, type ExtraKey } from '@/web/lib/render/pages';
import { renderSiteBundle } from '@/web/lib/render/site';
import { SECTION_IDS } from '@/web/lib/render/sections';
import type { WebsiteData } from '@/web/types';
import {
  PAGE_TITLES, SEARCH_THRESHOLD, addSuggested, changeFromRows, extraOnFromRows, matchesQuery, menuRows, moreStartsAt, pageChips, pageRows,
  pagesFromRows, placeText, serviceRows, setRowOn, showSearch, suggestedRows, withPageChange, withPagesByDefault,
} from '@/lib/sitePages';
import {
  IMAGE_PATHS, buildPreviewHtml, copyKeyOfPath, copyPath, editableTextPaths, markData, previewFileOf, textMaxLength, textValue,
} from '@/lib/editable';
import { parsePreviewMessage } from '@/lib/previewBridge';
import { applyHomePrompts, fieldLabel, savePathValue } from '@/lib/editor';
import { isCopyEdited, resetCopy, saveCopyText, tryOtherWording } from '@/lib/copyEdit';
import { moveRowBy, pageGoneReason, sectionRows, setSectionHidden, sectionPageFor } from '@/lib/pageSections';
import { clearHero, galleryChoices, isHeroPath, sampleHeroPaths, setPhoto } from '@/lib/pageHero';
import { heroOfPage } from '@/lib/pageFile';
import { imageUrlMap, withImages } from '@/lib/render';
import { shop } from './pagesV2Fixture';

const ALL_ON: { on: ExtraKey[]; serviceGuides: true; seed: number } = { on: ['faq', 'first-visit', 'hair-care', 'beard-care'], serviceGuides: true, seed: 7 };
const deepFreeze = <T,>(o: T): T => {
  if (o && typeof o === 'object') { Object.freeze(o); for (const v of Object.values(o as object)) deepFreeze(v); }
  return o;
};

describe('page titles and tabs', () => {
  test('every page key has a title, including the four guide pages', () => {
    for (const k of PAGE_KEYS) expect(PAGE_TITLES[k]).toBeTruthy();
    expect(PAGE_TITLES['first-visit']).toBe('First visit');
    expect(PAGE_TITLES['beard-care']).toBe('Beard care');
  });

  test('a site with every guide page on has them as top tabs; Services stays one tab with child chips', async () => {
    const d = await shop({ extraPages: ALL_ON });
    const chips = pageChips(d);
    const keys = chips.top.map((c) => c.key);
    expect(keys).toEqual(expect.arrayContaining(['faq', 'first-visit', 'hair-care', 'beard-care']));
    expect(keys.filter((k) => k === 'services')).toHaveLength(1);
    expect(chips.children.services).toHaveLength(3);
  });
});

describe('Pages sheet rows: groups', () => {
  test('on guide pages are menu pages; the rest are suggested', async () => {
    const d = await shop({ extraPages: { on: ['faq'], serviceGuides: true, seed: 1 } });
    const rows = pageRows(d);
    expect(menuRows(rows).map((r) => r.key)).toContain('faq');
    expect(menuRows(rows).find((r) => r.key === 'faq')).toMatchObject({ extra: true, on: true, group: 'menu' });
    expect(suggestedRows(rows).map((r) => r.key)).toEqual(['first-visit', 'hair-care', 'beard-care']);
    // menu rows come first, Home first of them and locked
    expect(rows.findIndex((r) => r.group === 'suggested')).toBe(menuRows(rows).length);
    expect(rows[0]).toMatchObject({ key: 'home', locked: true });
  });

  test('a site that never opted in lists every guide page as suggested and none in the menu', async () => {
    const d = await shop();
    expect(menuRows(pageRows(d)).some((r) => r.extra)).toBe(false);
    expect(suggestedRows(pageRows(d)).map((r) => r.key)).toEqual(['faq', 'first-visit', 'hair-care', 'beard-care']);
  });

  test('service pages are their own list: one per listed service', async () => {
    const d = await shop();
    expect(serviceRows(d).map((s) => s.title)).toEqual(['Haircut', 'Skin fade', 'Beard trim']);
  });

  test('Add moves a suggested page to the end of the menu, on', async () => {
    const d = await shop();
    const next = addSuggested(pageRows(d), 'faq');
    const menu = menuRows(next);
    expect(menu[menu.length - 1]).toMatchObject({ key: 'faq', on: true, group: 'menu' });
    expect(suggestedRows(next).map((r) => r.key)).not.toContain('faq');
  });
});

describe('disabled rows and their reasons', () => {
  test('a page the shop data cannot support is disabled with its reason and cannot be added', async () => {
    const d = await shop({ services: [{ title: 'Haircut', price: '$30' }] as WebsiteData['services'] });
    const beard = suggestedRows(pageRows(d)).find((r) => r.key === 'beard-care')!;
    expect(beard.eligible).toBe(false);
    expect(beard.reason).not.toBe('');
    const rows = pageRows(d);
    expect(addSuggested(rows, 'beard-care')).toBe(rows);
  });

  test('every section hidden: the page is a suggested row with the renderer\'s reason', async () => {
    let d = await shop({ extraPages: { on: ['faq'], serviceGuides: true, seed: 1 } });
    expect(menuRows(pageRows(d)).map((r) => r.key)).toContain('faq');
    for (const id of SECTION_IDS.faq.filter((x) => x !== 'cta')) d = setSectionHidden(d, 'faq', id, true);
    const row = suggestedRows(pageRows(d)).find((r) => r.key === 'faq')!;
    expect(row.eligible).toBe(false);
    expect(row.reason).toBe('Every section of this page is hidden. Show one to get this page');
    expect(pageGoneReason(d, { key: 'faq' })).toBe(row.reason);
    // showing one section brings the page back
    d = setSectionHidden(d, 'faq', 'book', false);
    expect(menuRows(pageRows(d)).map((r) => r.key)).toContain('faq');
  });

  test('turned on in the data but not supported yet: stays on in extraPages through a Save', async () => {
    const base = await shop({ services: [{ title: 'Haircut', price: '$30' }] as WebsiteData['services'], extraPages: { on: ['beard-care'], serviceGuides: false, seed: 3 } });
    const rows = pageRows(base);
    expect(suggestedRows(rows).find((r) => r.key === 'beard-care')?.reason).not.toBe('');
    expect(extraOnFromRows(rows, ['beard-care'])).toEqual(['beard-care']);
    expect(changeFromRows(base, rows, false).extraPages?.on).toEqual(['beard-care']);
  });
});

describe('search', () => {
  test('the box appears only when the lists are long', () => {
    expect(showSearch(SEARCH_THRESHOLD)).toBe(false);
    expect(showSearch(SEARCH_THRESHOLD + 1)).toBe(true);
  });
  test('matching ignores case and spacing', () => {
    expect(matchesQuery('First visit', 'FIRST  ')).toBe(true);
    expect(matchesQuery('Skin fade', 'beard')).toBe(false);
    expect(matchesQuery('Skin fade', '   ')).toBe(true);
  });
});

describe('place name row', () => {
  test('shows the default city from the address, then the edited name', async () => {
    const d = await shop();
    expect(placeText(d)).toBe('Brooklyn, NY');
    const edited = savePathValue(d, 'labels.pgPlace', 'Williamsburg, Brooklyn');
    expect(placeText(edited)).toBe('Williamsburg, Brooklyn');
    expect(edited.labels?.pgPlace).toBe('Williamsburg, Brooklyn');
    // the same words as the default are not stored
    expect(savePathValue(edited, 'labels.pgPlace', 'Brooklyn, NY').labels?.pgPlace).toBeUndefined();
  });
});

describe('divider before More', () => {
  test('after the fifth page that is on', () => {
    const r = (on: boolean) => ({ on });
    expect(moreStartsAt([r(true), r(true), r(true), r(true), r(true)])).toBe(-1);
    expect(moreStartsAt([r(true), r(true), r(true), r(true), r(true), r(true)])).toBe(5);
    expect(moreStartsAt([r(true), r(false), r(true), r(true), r(true), r(true), r(true)])).toBe(6);
  });
});

describe('guide pages are turned on and off only through extraPages.on', () => {
  test('on: a Save adds the page to extraPages.on and never writes pages.hidden for it; off removes it', async () => {
    const d = await shop();
    let rows = addSuggested(pageRows(d), 'first-visit');
    const on = changeFromRows(d, rows, false, () => 42);
    expect(on.extraPages).toEqual({ on: ['first-visit'], serviceGuides: false, seed: 42 });
    expect(on.pages.hidden).toEqual([]);
    expect(on.pages.order).toContain('first-visit');
    const saved = withPageChange(d, on);
    rows = setRowOn(pageRows(saved), 'first-visit', false);
    const off = changeFromRows(saved, rows, false, () => 99);
    expect(off.extraPages?.on).toEqual([]);
    expect(off.pages.hidden).not.toContain('first-visit');
    expect(off.extraPages?.seed).toBe(42); // the seed is made once
  });

  test('a built-in page off still goes to pages.hidden', async () => {
    const d = await shop();
    const hidden = pagesFromRows(setRowOn(pageRows(d), 'hours', false));
    expect(hidden.hidden).toEqual(['hours']);
  });

  test('turning on a guide page makes the renderer publish it', async () => {
    const d = await shop();
    const next = withPageChange(d, changeFromRows(d, addSuggested(pageRows(d), 'faq'), true, () => 5));
    const files = renderSiteBundle(next).pages.map((p) => p.path);
    expect(files).toContain('faq/index.html');
    expect(renderSiteBundle(d).pages.map((p) => p.path)).not.toContain('faq/index.html');
  });

  test('a site that turns nothing on and keeps guides off gains no extraPages', async () => {
    const d = await shop();
    const c = changeFromRows(d, pageRows(d), false);
    expect(c.extraPages).toBeUndefined();
    expect(withPageChange(d, c).extraPages).toBeUndefined();
  });

  test('extraPages keeps its pick and photos through a Save', async () => {
    const d = await shop({ extraPages: { on: ['first-visit'], serviceGuides: true, seed: 8, pick: { 'first-visit.booking': 2 }, images: { 'first-visit': 'https://x/y.jpg' } } });
    const next = withPageChange(d, changeFromRows(d, pageRows(d), true));
    expect(next.extraPages).toEqual(d.extraPages);
  });
});

describe('defaults only for newly generated sites', () => {
  test('a new site gets the suggested guide pages and a stable seed', async () => {
    const d = await shop({ pages: undefined });
    const n = withPagesByDefault(d, () => 1234);
    expect(n.extraPages).toEqual({ on: ['faq', 'first-visit'], serviceGuides: true, seed: 1234 });
    // opening it again changes nothing, so the seed is stable
    expect(withPagesByDefault(n, () => 9999)).toBe(n);
  });
  test('an existing multi-page site gains nothing', async () => {
    const d = await shop();
    expect(withPagesByDefault(d)).toBe(d);
    expect(withPagesByDefault(d).extraPages).toBeUndefined();
  });
  test('a rebuild keeps the page choices, guide pages, edited texts and sections', async () => {
    const d = await shop({ extraPages: ALL_ON, copy: { 'faq.book': 'Call or tap Book.' }, pageSections: { faq: { hidden: ['kids'] } } });
    const out = await applyHomePrompts(d, 'Queens, NY', '5125550101');
    expect(out.pages).toEqual(d.pages);
    expect(out.extraPages).toEqual(d.extraPages);
    expect(out.copy).toEqual(d.copy);
    expect(out.pageSections).toEqual(d.pageSections);
  });
});

describe('library text: paths, limits, immutable updates', () => {
  test('copy paths are the closed library set', () => {
    expect(copyKeyOfPath('copy.faq.book')).toBe('faq.book');
    expect(copyKeyOfPath('copy.guide.fade.what')).toBe('guide.fade.what');
    expect(copyKeyOfPath('copy.nope')).toBeNull();
    expect(copyKeyOfPath('labels.pgPlace')).toBeNull();
    expect(copyPath('faq.book')).toBe('copy.faq.book');
    expect(textMaxLength('copy.faq.book')).toBeGreaterThan(0);
  });

  test('textValue is the suggested wording until the barber writes their own', async () => {
    const d = await shop({ extraPages: ALL_ON });
    const suggested = textValue(d, 'copy.faq.book');
    expect(suggested).not.toBe('');
    const edited = savePathValue(d, 'copy.faq.book', 'Tap Book or call.');
    expect(textValue(edited, 'copy.faq.book')).toBe('Tap Book or call.');
    expect(isCopyEdited(edited, 'faq.book')).toBe(true);
    expect(fieldLabel('copy.faq.book')).toMatch(/book/i);
  });

  test('saving never changes the old objects: copy and extraPages are replaced, not mutated', async () => {
    const d = deepFreeze(await shop({ extraPages: ALL_ON, copy: { 'faq.hours': 'Open most days.' } }));
    const a = saveCopyText(d, 'faq.book', 'Tap Book.');
    expect(a.copy).not.toBe(d.copy);
    expect(a.copy).toEqual({ 'faq.hours': 'Open most days.', 'faq.book': 'Tap Book.' });
    expect(d.copy).toEqual({ 'faq.hours': 'Open most days.' });
    const b = resetCopy(a, 'faq.book');
    expect(b.copy).not.toBe(a.copy);
    expect(a.copy?.['faq.book']).toBe('Tap Book.');
    const c = tryOtherWording(d, 'faq.book');
    expect(c.extraPages).not.toBe(d.extraPages);
    expect(c.extraPages?.pick).toBeDefined();
    expect(d.extraPages?.pick).toBeUndefined();
  });

  test('the same words as the suggested text, or nothing, remove the override; the last override leaves no copy', async () => {
    const d = await shop({ extraPages: ALL_ON });
    const own = saveCopyText(d, 'faq.book', 'Tap Book.');
    expect(own.copy).toEqual({ 'faq.book': 'Tap Book.' });
    expect(saveCopyText(own, 'faq.book', '   ').copy).toBeUndefined();
    expect(saveCopyText(own, 'faq.book', textValue(d, 'copy.faq.book')).copy).toBeUndefined();
    expect(saveCopyText(d, 'not.a.key', 'x')).toBe(d);
    expect(savePathValue(d, 'copy.not.a.key', 'x')).toBe(d);
  });

  test('text is cut to the block maximum', async () => {
    const d = await shop({ extraPages: ALL_ON });
    const max = textMaxLength('copy.faq.book')!;
    const out = saveCopyText(d, 'faq.book', 'a'.repeat(max + 50));
    expect(out.copy!['faq.book']).toHaveLength(max);
  });

  test('Try other wording picks the next of three, wraps, and drops the barber\'s own text', async () => {
    let d = await shop({ extraPages: { ...ALL_ON, pick: { 'faq.book': 2 } }, copy: { 'faq.book': 'Mine.' } });
    d = tryOtherWording(d, 'faq.book');
    expect(d.extraPages?.pick?.['faq.book']).toBe(0);
    expect(d.copy).toBeUndefined();
    d = tryOtherWording(d, 'faq.book');
    expect(d.extraPages?.pick?.['faq.book']).toBe(1);
  });

  test('a change reaches the rendered page (the renderer sees the new copy object)', async () => {
    const d = await shop({ extraPages: ALL_ON });
    const html = (x: WebsiteData) => renderSiteBundle(x).pages.find((p) => p.path === 'faq/index.html')!.html;
    const before = html(d);
    const edited = saveCopyText(d, 'faq.book', 'Zebra crossing wording.');
    expect(html(edited)).toContain('Zebra crossing wording.');
    expect(before).not.toContain('Zebra crossing wording.');
    const again = saveCopyText(edited, 'faq.book', 'Giraffe wording.');
    expect(html(again)).toContain('Giraffe wording.');
    expect(html(again)).not.toContain('Zebra');
    expect(html(resetCopy(again, 'faq.book'))).not.toContain('Giraffe');
  });
});

describe('tap-to-edit of library text in the preview', () => {
  test('the paths of a guide page are tappable on that page only, and the bridge accepts them there', async () => {
    const d = await shop({ extraPages: ALL_ON });
    expect(editableTextPaths(d, { key: 'faq' })).toContain('copy.faq.book');
    expect(editableTextPaths(d, { key: 'hours' })).not.toContain('copy.faq.book');
    const msg = JSON.stringify({ type: 'edit', path: 'copy.faq.book' });
    expect(parsePreviewMessage(msg, d, { key: 'faq' })).toEqual({ type: 'edit', path: 'copy.faq.book' });
    expect(parsePreviewMessage(msg, d, { key: 'hours' })).toBeNull();
  });
  test('a service page shows its guide blocks, once per guide', async () => {
    const d = await shop({ extraPages: ALL_ON });
    const fadeIdx = d.services.findIndex((s) => s.title === 'Skin fade');
    const paths = editableTextPaths(d, { key: 'services', index: fadeIdx });
    expect(paths.some((p) => p.startsWith('copy.guide.fade.'))).toBe(true);
    expect(paths.some((p) => p.startsWith('copy.guide.beard-trim.'))).toBe(false);
  });
  test('the marked preview carries tap targets, and the stored data is never marked', async () => {
    const d = await shop({ extraPages: ALL_ON });
    const { marked, ids } = markData(d, { key: 'faq' });
    expect(Object.values(ids)).toContain('copy.faq.book');
    expect(marked.copy).not.toBe(d.copy);
    expect(d.copy).toBeUndefined();
    const html = buildPreviewHtml(d, true, null, { key: 'faq' });
    expect(html).toContain('data-edit="copy.faq.book"');
    expect(html).not.toContain('⁣');
    // the published-style preview has no tap targets
    expect(buildPreviewHtml(d, false, null, { key: 'faq' })).not.toContain('data-edit');
  });
  test('a text with several lines keeps one tap target per item', async () => {
    const { markCopyText } = require('@/lib/editable');
    const m = markCopyText('one\n\ntwo', 'p', 100, 'a');
    expect(m.split('⁣a⁣')).toHaveLength(3);
    expect(markCopyText('x'.repeat(30), 'p', 10, 'a')).toContain('x'.repeat(10) + '⁣/⁣');
  });
});

describe('Edit this page: sections', () => {
  test('every section of a guide page is listed once, with its kind', async () => {
    const d = await shop({ extraPages: ALL_ON });
    expect(sectionPageFor({ key: 'faq' })).toBe('faq');
    expect(sectionPageFor({ key: 'hours' })).toBeNull();
    expect(sectionPageFor({ key: 'services' })).toBeNull();
    expect(sectionPageFor({ key: 'services', index: 0 })).toBe('service');
    const rows = sectionRows(d, { key: 'first-visit' });
    expect(rows[0]).toMatchObject({ id: 'hero', kind: 'photo' });
    expect(rows.find((r) => r.id === 'cta')?.kind).toBe('fixed');
    expect(rows.filter((r) => r.kind === 'text').every((r) => !!r.copyKey)).toBe(true);
    expect(new Set(rows.map((r) => r.id)).size).toBe(rows.length);
  });

  test('Location data rows point at the editor that holds the facts', async () => {
    const d = await shop();
    const rows = sectionRows(d, { key: 'location' });
    expect(rows.find((r) => r.id === 'hours')?.source).toBe('hours');
    expect(rows.find((r) => r.id === 'map')?.source).toBe('contact');
  });

  test('hide and show are stored per page type, without touching the old object', async () => {
    const d = deepFreeze(await shop({ extraPages: ALL_ON }));
    const hid = setSectionHidden(d, 'service', 'others', true);
    expect(hid.pageSections?.service?.hidden).toEqual(['others']);
    expect(d.pageSections).toBeUndefined();
    // the layout is shared by every service page
    const a = sectionRows(hid, { key: 'services', index: 0 }).find((r) => r.id === 'others')!;
    const b = sectionRows(hid, { key: 'services', index: 1 }).find((r) => r.id === 'others')!;
    expect(a.hidden && b.hidden).toBe(true);
    expect(setSectionHidden(hid, 'service', 'others', false).pageSections?.service?.hidden).toEqual([]);
    expect(setSectionHidden(d, 'service', 'not-a-section', true)).toBe(d);
  });

  test('moving a section swaps it with its visible neighbour and shows in the page', async () => {
    const d = await shop({ extraPages: ALL_ON });
    const before = sectionRows(d, { key: 'first-visit' }).map((r) => r.id);
    const moved = moveRowBy(d, { key: 'first-visit' }, before[1], -1);
    const after = sectionRows(moved, { key: 'first-visit' }).map((r) => r.id);
    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe(before[0]);
    expect(moveRowBy(d, { key: 'first-visit' }, before[0], -1)).toBe(d);
    expect(moveRowBy(d, { key: 'hours' }, 'x', 1)).toBe(d);
  });

  test('a hidden section does not print on the page', async () => {
    const d = await shop({ extraPages: ALL_ON });
    const rows = sectionRows(d, { key: 'faq' });
    const target = rows.find((r) => r.kind === 'text')!;
    const text = textValue(d, copyPath(target.copyKey!));
    // The body only: the page's meta description is built from the first library block whether or not it is hidden.
    const html = (x: WebsiteData) => renderSiteBundle(x).pages.find((p) => p.path === 'faq/index.html')!.html.split('</head>')[1];
    expect(html(d)).toContain(text.slice(0, 10).replace(/&/g, '&amp;'));
    expect(html(setSectionHidden(d, 'faq', target.id, true))).not.toContain(text.slice(0, 10).replace(/&/g, '&amp;'));
  });
});

describe('page hero photos', () => {
  test('paths: a service page and a guide page; none on FAQ or on a site without extraPages', async () => {
    const d = await shop({ extraPages: ALL_ON });
    expect(IMAGE_PATHS(d, { key: 'services', index: 1 })).toContain('services.1.imageUrl');
    expect(IMAGE_PATHS(d, { key: 'first-visit' })).toContain('extraPages.images.first-visit');
    expect(IMAGE_PATHS(d, { key: 'faq' }).some(isHeroPath)).toBe(false);
    expect(IMAGE_PATHS(d).some(isHeroPath)).toBe(false); // the Photos sheet never lists them
    const plain = await shop();
    expect(IMAGE_PATHS(plain, { key: 'services', index: 1 }).some(isHeroPath)).toBe(false);
  });

  test('the bridge accepts a hero path only on its own page', async () => {
    const d = await shop({ extraPages: ALL_ON });
    const msg = JSON.stringify({ type: 'image', path: 'extraPages.images.first-visit' });
    expect(parsePreviewMessage(msg, d, { key: 'first-visit' })).toEqual({ type: 'image', path: 'extraPages.images.first-visit' });
    expect(parsePreviewMessage(msg, d, { key: 'hair-care' })).toBeNull();
  });

  test('no photo: a sample, flagged for the editor prompt; an own photo is not', async () => {
    const d = await shop({ extraPages: ALL_ON });
    expect(sampleHeroPaths(d, { key: 'first-visit' })).toEqual(['extraPages.images.first-visit']);
    expect(heroOfPage(d, { key: 'first-visit' })).toMatchObject({ own: false, sample: true });
    const own = setPhoto(d, 'extraPages.images.first-visit', '  https://cdn.example.com/a.jpg \n');
    expect(own.extraPages?.images?.['first-visit']).toBe('https://cdn.example.com/a.jpg');
    expect(sampleHeroPaths(own, { key: 'first-visit' })).toEqual([]);
    expect(heroOfPage(own, { key: 'first-visit' })).toMatchObject({ own: true, sample: false });
  });

  test('the editor preview taps both kinds of hero; the published-style preview does not', async () => {
    const d = await shop({ extraPages: ALL_ON });
    const sample = buildPreviewHtml(d, true, null, { key: 'first-visit' });
    expect(sample).toContain('data-edit-image="extraPages.images.first-visit"');
    const own = setPhoto(d, 'services.1.imageUrl', 'https://cdn.example.com/fade.jpg');
    const ownHtml = buildPreviewHtml(own, true, null, { key: 'services', index: 1 });
    expect(ownHtml).toContain('data-edit-image="services.1.imageUrl"');
    expect(ownHtml).toContain('https://cdn.example.com/fade.jpg');
    const plain = buildPreviewHtml(own, false, null, { key: 'services', index: 1 });
    expect(plain).toContain('https://cdn.example.com/fade.jpg');
    expect(plain).not.toContain('data-edit-image');
    expect(plain).not.toMatch(/Sample photo/i);
    // the prompt is the app's, never part of any rendered page
    for (const p of renderSiteBundle(d).pages) expect(p.html).not.toMatch(/replace with yours/i);
  });

  test('Use sample photo clears the slot; a bad link is not stored', async () => {
    let d = setPhoto(await shop({ extraPages: ALL_ON }), 'services.0.imageUrl', 'https://cdn.example.com/a.jpg');
    expect(setPhoto(d, 'services.0.imageUrl', 'javascript:alert(1)')).toBe(d);
    expect(setPhoto(d, 'services.0.imageUrl', '   ')).toBe(d);
    d = clearHero(d, 'services.0.imageUrl');
    expect(d.services[0].imageUrl).toBe('');
    expect(heroOfPage(d, { key: 'services', index: 0 })?.sample).toBe(true);
    expect(clearHero(d, 'hero.imageUrl')).toBe(d);
  });

  test('page placeholders are filled in the preview', async () => {
    const d = setPhoto(await shop({ extraPages: ALL_ON }), 'extraPages.images.hair-care', 'https://cdn.example.com/h.jpg');
    expect(imageUrlMap(d)['page-hair-care']).toBe('https://cdn.example.com/h.jpg');
    expect(withImages('<img src="{{page-hair-care}}">', d)).toContain('https://cdn.example.com/h.jpg');
  });

  test('gallery choices: the shop\'s own photos first, no samples', async () => {
    const d = await shop({ gallery: ['https://cdn.example.com/g1.jpg', '', ' https://cdn.example.com/g1.jpg ', 'https://cdn.example.com/g2.jpg'] });
    expect(galleryChoices(d)).toEqual(['https://cdn.example.com/g1.jpg', 'https://cdn.example.com/g2.jpg']);
  });

  test('the Services sheet trims a pasted photo link', () => {
    const { updateService } = require('@/lib/sections/services');
    const d = { services: [{ title: 'Cut' }] } as unknown as WebsiteData;
    const out = updateService(d, 0, { title: 'Cut', price: '', duration: 30, description: '', imageUrl: '  https://x/y.jpg\n', subtitle: '', icon: '' } as never);
    expect(out.services[0].imageUrl).toBe('https://x/y.jpg');
  });
});

describe('existing sites are not changed by the app', () => {
  test('a preview of a site without extraPages has no guide pages and no hero tap targets', async () => {
    const d = await shop();
    expect(pageChips(d).top.map((c) => c.key)).not.toEqual(expect.arrayContaining(['faq']));
    const html = buildPreviewHtml(d, true, null, { key: 'services', index: 0 });
    expect(html).not.toContain('data-edit-image="services.0.imageUrl"');
    expect(previewFileOf(renderSiteBundle(d).set, { key: 'services', index: 0 }).path).toContain('services/');
    expect(extraPageRows(d).every((r) => !r.on)).toBe(true);
  });
});
