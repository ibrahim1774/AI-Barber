// P3b (spec 2026-10-23-barber-experience): the Pages sheet model, the page-aware preview and its bridge.
import { generateContent } from '@/web/services/geminiService';
import { buildPageSet, cleanPagesModel } from '@/web/lib/render/pages';
import type { TemplateId, WebsiteData } from '@/web/types';
import { buildPreviewHtml, editableTextPaths, markData, previewFileOf, setPath, textValue } from '@/lib/editable';
import { imageUrlMap } from '@/lib/render';
import { parsePreviewMessage } from '@/lib/previewBridge';
import { savePathValue, applyHomePrompts } from '@/lib/editor';
import {
  barberNeedsDescription, defaultPages, moveRow, needsMultiPageConfirm, pageChips, pageRows, pagesFromRows, resolvePage,
  pageRows as rowsOf, servicesOverCapNote, servicesOverCapOf, setRowOn, withPages, withPagesByDefault,
} from '@/lib/sitePages';

const inputs = {
  shopName: 'Fresh Cuts', area: 'Brooklyn, NY', phone: '5125550142',
  services: [{ title: 'Haircut', price: '$30' }, { title: 'Skin fade' }],
};
const rich = (d: WebsiteData): WebsiteData => ({
  ...d,
  about: { ...d.about, description: ['We have cut hair on Atlantic Avenue since 2011.'] },
  services: [{ title: 'Haircut', price: '$30' }, { title: 'Skin fade', description: 'Tight and clean.' }, { title: 'Beard trim' }] as WebsiteData['services'],
  gallery: ['u0', 'u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7'],
  reviews: [{ author: 'Al', comment: 'Great cut', rating: 5 }, { author: 'Bo', comment: 'Fine work', rating: 4 }],
  hours: [{ day: 'Mon', open: '09:00', close: '17:00' }],
  staff: [{ name: 'Sam', role: 'Barber', photo: 'p', bio: 'Sam fades.' }, { name: 'Kit', role: 'Barber' }],
  bookingUrl: 'https://booksy.com/x',
  contact: { address: '1 Main St, Brooklyn, NY', email: 'hi@example.com' },
});
const multi = (d: WebsiteData): WebsiteData => ({ ...d, pages: defaultPages() });
let sites: Record<TemplateId, WebsiteData>;
beforeAll(async () => {
  sites = {} as Record<TemplateId, WebsiteData>;
  for (const template of ['luxe', 'prime', 'euphoria'] as TemplateId[]) {
    const g = await generateContent({ ...inputs, template });
    sites[template] = rich({ ...g, template });
  }
});
// The templates stamp the publish time into the page.
const stable = (h: string) => h.replace(/published-at" content="\d+"/, 'published-at" content="0"');
const TEMPLATES: TemplateId[] = ['luxe', 'prime', 'euphoria'];

describe('Pages model', () => {
  test('a site without pages asks for the confirm; a newly generated one gets pages by default', () => {
    const d = sites.luxe;
    expect(d.pages).toBeUndefined();
    expect(needsMultiPageConfirm(d)).toBe(true);
    const n = withPagesByDefault(d);
    expect(n.pages).toEqual({ order: [], hidden: [] });
    expect(needsMultiPageConfirm(n)).toBe(false);
    // a choice already made (even every page off) is kept
    const chosen = { ...d, pages: { order: ['gallery' as const], hidden: ['about' as const] } };
    expect(withPagesByDefault(chosen)).toBe(chosen);
  });

  test('rows list the eligible pages with Home first and locked on', () => {
    const rows = pageRows(sites.luxe);
    expect(rows[0]).toMatchObject({ key: 'home', locked: true, on: true });
    const keys = rows.map((r) => r.key);
    expect(keys).toEqual(expect.arrayContaining(['about', 'services', 'team', 'gallery', 'reviews', 'hours', 'location', 'contact']));
    expect(rows.find((r) => r.key === 'services')?.children).toBe(3);
    expect(rows.find((r) => r.key === 'team')?.children).toBe(1); // Kit has a role only: no page
  });

  test('toggle off, reorder, save: pages {order, hidden}; Home cannot move or switch off', () => {
    let rows = pageRows(sites.luxe);
    rows = setRowOn(rows, 'about', false);
    rows = setRowOn(rows, 'home', false);
    expect(rows[0].on).toBe(true);
    const gi = rows.findIndex((r) => r.key === 'gallery');
    rows = moveRow(rows, gi, 1);
    expect(rows[1].key).toBe('gallery');
    expect(moveRow(rows, 0, 3)).toBe(rows);
    expect(moveRow(rows, 2, 0)[1].key).toBe(rows[2].key); // never above Home
    const model = pagesFromRows(rows);
    expect(model.hidden).toEqual(['about']);
    expect(model.order[0]).toBe('gallery');
    expect(model.order).not.toContain('home');
    expect(cleanPagesModel(model)).toEqual(model);
    const saved = withPages(sites.luxe, model);
    expect(saved.pages).toEqual(model);
    expect(buildPageSet(saved).nav.slice(0, 2)).toEqual(['home', 'gallery']);
    expect(buildPageSet(saved).nav).not.toContain('about');
  });
});

describe('hints', () => {
  test('every titled service gets a page; none is over the cap', () => {
    const d = multi(sites.luxe);
    expect(pageChips(d).children.services?.map((x) => x.title)).toEqual(['Haircut', 'Skin fade', 'Beard trim']);
    expect(servicesOverCapOf(d)).toBe(0);
    expect(servicesOverCapNote(0)).toBeNull();
  });
  test('services past the cap: one Services tab, 12 child chips, and a note', () => {
    const many = { ...multi(sites.luxe), services: Array.from({ length: 15 }, (_, i) => ({ title: `Cut ${i + 1}` })) as WebsiteData['services'] };
    const c = pageChips(many);
    expect(c.top.filter((t) => t.key === 'services')).toHaveLength(1);
    expect(c.children.services).toHaveLength(12);
    expect(servicesOverCapOf(many)).toBe(3);
    expect(servicesOverCapNote(3)).toBe('Only the first 12 services get their own page.');
  });
  test('Location is a normal page with its own title; Hours is titled Hours', () => {
    const d = multi(sites.luxe);
    const rows = rowsOf(d);
    expect(rows.find((r) => r.key === 'location')?.title).toBe('Location');
    expect(rows.find((r) => r.key === 'hours')?.title).toBe('Hours');
    expect(pageChips(d).top.map((t) => t.key)).toContain('location');
    expect(resolvePage(d, { key: 'location' })).toEqual({ key: 'location' });
    expect(resolvePage(d, { key: 'services', index: 2 })).toEqual({ key: 'services', index: 2 });
  });
  test('a barber with only a name and role', () => {
    const d = sites.luxe;
    expect(barberNeedsDescription(d, 0)).toBe(false);
    expect(barberNeedsDescription(d, 1)).toBe(true);
    expect(barberNeedsDescription(d, 5)).toBe(false);
  });
});

describe('page chips and resolving', () => {
  test('a single-page site has nothing to switch', () => {
    expect(pageChips(sites.luxe).top).toEqual([]);
  });
  test('top chips = the nav; service and team pages are children', () => {
    const c = pageChips(multi(sites.luxe));
    expect(c.top[0].key).toBe('home');
    expect(c.top.map((t) => t.key)).toContain('services');
    expect(c.children.services?.map((s) => s.title)).toEqual(['Haircut', 'Skin fade', 'Beard trim']);
    expect(c.children.team?.map((s) => s.title)).toEqual(['Sam']);
  });
  test('a page that is off or an item that is gone falls back', () => {
    const d = withPages(multi(sites.luxe), { order: [], hidden: ['gallery'] });
    expect(resolvePage(d, { key: 'gallery' })).toEqual({ key: 'home' });
    expect(resolvePage(d, { key: 'services', index: 1 })).toEqual({ key: 'services', index: 1 });
    expect(resolvePage(d, { key: 'services', index: 9 })).toEqual({ key: 'services' });
    expect(resolvePage(sites.luxe, { key: 'services' })).toEqual({ key: 'home' }); // not opted in
  });
});

describe('page-aware preview', () => {
  test.each(TEMPLATES)('%s: markers do not change which pages exist or their paths', (t) => {
    const d = multi(sites[t]);
    const plain = buildPageSet(d, { imageUrls: imageUrlMap(d) });
    const { marked } = markData(d, { key: 'services' });
    const set = buildPageSet(marked, { imageUrls: imageUrlMap(d) });
    expect(set.files.map((f) => f.path)).toEqual(plain.files.map((f) => f.path));
  });

  test.each(TEMPLATES)('%s: a service page renders that service, tappable, and Home still renders', (t) => {
    const d = multi(sites[t]);
    const set = buildPageSet(d, { imageUrls: imageUrlMap(d) });
    expect(previewFileOf(set, { key: 'services', index: 1 }).path).toBe('services/skin-fade/index.html');
    const html = buildPreviewHtml(d, true, null, { key: 'services', index: 1 });
    expect(html).toContain('Skin fade');
    expect(html).toContain('data-edit="labels.pgBackServices"');
    expect(html).not.toMatch(/⁣/);
    expect(html).toContain('<title>');
    const home = buildPreviewHtml(d, true);
    expect(home).toContain('data-edit="shopName"');
    expect(home).toMatch(/pgNav/);
  });

  test('a single-page site previews exactly as before whatever page is asked for', () => {
    const d = sites.luxe;
    expect(stable(buildPreviewHtml(d, true, null, { key: 'services', index: 0 }))).toBe(stable(buildPreviewHtml(d, true)));
  });

  test('a page that is off shows Home', () => {
    const d = withPages(multi(sites.luxe), { order: [], hidden: ['gallery'] });
    expect(stable(buildPreviewHtml(d, false, null, { key: 'gallery' }))).toBe(stable(buildPreviewHtml(d, false, null, { key: 'home' })));
  });

  test('editing a text on a service page: service title and a page label save through the same paths', () => {
    const d = multi(sites.luxe);
    const html = buildPreviewHtml(d, true, null, { key: 'services', index: 0 });
    expect(html).toContain('data-edit="services.0.title"');
    const edited = savePathValue(d, 'labels.pgBackServices', 'All our services');
    expect(edited.labels?.pgBackServices).toBe('All our services');
    expect(buildPreviewHtml(edited, true, null, { key: 'services', index: 0 })).toContain('All our services');
    expect(textValue(edited, 'labels.pgBackServices')).toBe('All our services');
    const renamed = setPath(d, 'services.0.title', 'Classic cut');
    expect(buildPreviewHtml(renamed, true, null, { key: 'services', index: 0 })).toContain('Classic cut');
  });
});

describe('bridge accepts a page label only on its page', () => {
  const msg = (path: string) => JSON.stringify({ type: 'edit', path });
  test('pgBackServices: service page yes, Home no, no page given = the Home render', () => {
    const d = multi(sites.luxe);
    expect(parsePreviewMessage(msg('labels.pgBackServices'), d, { key: 'services', index: 0 })).toEqual({ type: 'edit', path: 'labels.pgBackServices' });
    expect(parsePreviewMessage(msg('labels.pgBackServices'), d, { key: 'home' })).toBeNull();
    expect(parsePreviewMessage(msg('labels.pgBackServices'), d)).toBeNull(); // no page given renders Home
    expect(editableTextPaths(d, { key: 'services' })).not.toContain('labels.pgMenu');
  });
  test('single-page sites keep today\'s list: no page labels', () => {
    expect(editableTextPaths(sites.luxe).some((p) => p.startsWith('labels.pg'))).toBe(false);
  });
});

describe('pages survive the rebuilds that replace the data', () => {
  test('applyHomePrompts keeps pages', async () => {
    const d = multi(sites.luxe);
    const out = await applyHomePrompts(d, 'Queens, NY', '5125550100');
    expect(out.pages).toEqual({ order: [], hidden: [] });
  });
});

describe('team description (what makes a barber page)', () => {
  const { updateMember, addMember } = require('@/lib/sections/team');
  test('a typed description is stored, cleared when emptied, and left alone when not sent', () => {
    const d = sites.luxe;
    const withBio = updateMember(d, 1, { name: 'Kit', role: 'Barber', bio: 'Kit does beards.' });
    expect(withBio.staff?.[1].bio).toBe('Kit does beards.');
    expect(barberNeedsDescription(withBio, 1)).toBe(false);
    expect(updateMember(withBio, 1, { name: 'Kit', role: 'Barber', bio: '' }).staff?.[1].bio).toBeUndefined();
    expect(updateMember(withBio, 1, { name: 'Kit2' }).staff?.[1].bio).toBe('Kit does beards.');
    expect(addMember(d, { name: 'Lee', bio: 'Hi' }).staff?.[2].bio).toBe('Hi');
  });
});

describe('pages reach disk and the server', () => {
  test('saveSite/loadSite and the publish payload keep pages', async () => {
    const { saveSite, loadSite, clearSite } = require('@/lib/siteStore');
    const { publishPayload } = require('@/lib/publish');
    const d = withPages(sites.luxe, { order: ['gallery'], hidden: ['about'] });
    await clearSite();
    await saveSite({ draftId: 'd1', inputs: { shopName: 'Fresh Cuts', area: '', phone: '' }, data: d, updatedAt: 1, slug: null, deployedUrl: null, transactionId: null });
    expect((await loadSite())?.data.pages).toEqual({ order: ['gallery'], hidden: ['about'] });
    expect(publishPayload(d).pages).toEqual({ order: ['gallery'], hidden: ['about'] });
    // the editor's markers never reach the server, in pages or anywhere else
    expect(JSON.stringify(publishPayload(markData(d).marked))).not.toMatch(/⁣/);
  });
});
