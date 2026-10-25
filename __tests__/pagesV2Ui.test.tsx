import React from 'react';
jest.mock('@/constants/theme', () => require('./store/themeMock'));
jest.mock('@/lib/analytics', () => ({ track: jest.fn() }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
import type { WebsiteData } from '@/web/types';
import { PagesSheet } from '@/components/PagesSheet';
import { PageSectionsSheet } from '@/components/PageSectionsSheet';
import { HeroPhotoSheet } from '@/components/HeroPhotoSheet';
import { EditSheet } from '@/components/EditSheet';
import type { PageChips } from '@/lib/sitePages';
import { shop } from './pagesV2Fixture';

const { act, create } = require('react-test-renderer');

const texts = (tree: any): string[] => tree.root.findAll((n: any) => typeof n.props?.children === 'string' && n.type === 'Text').map((n: any) => n.props.children);
const byLabel = (tree: any, label: string | RegExp) => tree.root.findAll((n: any) => (typeof label === 'string' ? n.props?.accessibilityLabel === label : label.test(n.props?.accessibilityLabel ?? '')) && typeof n.props?.onPress === 'function');
const ALL = { on: ['faq', 'first-visit', 'hair-care', 'beard-care'], serviceGuides: true, seed: 3 } as WebsiteData['extraPages'];

describe('Pages sheet', () => {
  async function mount(extra: Partial<WebsiteData> = {}) {
    const d = await shop(extra);
    const onSave = jest.fn();
    const onClose = jest.fn();
    const onEditPlace = jest.fn();
    let tree: any;
    act(() => { tree = create(<PagesSheet visible data={d} onSave={onSave} onEditPlace={onEditPlace} onClose={onClose} />); });
    // Service pages are a second level, closed until the Services toggle is tapped.
    const toggle = byLabel(tree, /^Service pages, \d+$/ as never);
    if (toggle.length) act(() => { toggle[0].props.onPress(); });
    return { d, onSave, onClose, onEditPlace, tree };
  }

  test('three groups, the place row and the one-line note', async () => {
    const m = await mount({ extraPages: { on: ['faq'], serviceGuides: true, seed: 1 } as never });
    const t = texts(m.tree);
    expect(t).toEqual(expect.arrayContaining(['Menu pages', '▾  Service pages (3)', 'Suggested pages', 'Place name', 'Brooklyn, NY']));
    expect(t).toContain("Location pages cover your shop's own area only.");
    expect(byLabel(m.tree, 'Add First visit')).toHaveLength(1);
    expect(byLabel(m.tree, 'Show Skin fade')).toHaveLength(1);
  });

  test('Add then Save writes the page through extraPages.on', async () => {
    const m = await mount();
    act(() => { byLabel(m.tree, 'Add FAQ')[0].props.onPress(); });
    const save = m.tree.root.findAll((n: any) => n.props?.accessibilityRole === 'button' && typeof n.props?.onPress === 'function' && n.findAll?.((c: any) => c.props?.children === 'Save').length > 0)[0];
    act(() => { save.props.onPress(); });
    expect(m.onSave).toHaveBeenCalledTimes(1);
    const change = m.onSave.mock.calls[0][0];
    expect(change.extraPages.on).toEqual(['faq']);
    expect(change.pages.hidden).toEqual([]);
    expect(m.onClose).toHaveBeenCalled();
  });

  test('a disabled row shows its reason and its Add button does nothing', async () => {
    const m = await mount({ services: [{ title: 'Haircut', price: '$30' }] as never });
    const t = texts(m.tree);
    const reason = t.find((x) => /beard/i.test(x) && x.length > 20);
    expect(reason).toBeTruthy();
    const add = byLabel(m.tree, 'Add Beard care')[0];
    expect(add.props.disabled).toBe(true);
  });

  test('the search box appears when the lists are long and filters', async () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ title: `Cut ${i}`, price: '$20' }));
    const m = await mount({ services: many as never, extraPages: ALL as never });
    const box = m.tree.root.findAll((n: any) => n.props?.accessibilityLabel === 'Search pages' && typeof n.props?.onChangeText === 'function')[0];
    expect(box).toBeTruthy();
    act(() => { box.props.onChangeText('cut 11'); });
    expect(byLabel(m.tree, 'Show Cut 11')).toHaveLength(1);
    expect(byLabel(m.tree, 'Show Cut 2')).toHaveLength(0);
  });

  test('no search box for a short list', async () => {
    const m = await mount();
    expect(m.tree.root.findAll((n: any) => n.props?.accessibilityLabel === 'Search pages')).toHaveLength(0);
  });

  test('the place row opens the label editor', async () => {
    const m = await mount();
    act(() => { byLabel(m.tree, 'Place name, Brooklyn, NY. Change')[0].props.onPress(); });
    expect(m.onEditPlace).toHaveBeenCalledTimes(1);
  });

  test('tapping a service shows that service page', async () => {
    const m = await mount();
    act(() => { byLabel(m.tree, 'Show Skin fade')[0].props.onPress(); });
    expect(m.onSave.mock.calls[0][1]).toEqual({ key: 'services', index: 1 });
  });
});

describe('Edit this page sheet', () => {
  test('hide, move, edit text and change image reach the callbacks; the heading is locked', async () => {
    let d = await shop({ extraPages: ALL as never });
    const onChange = jest.fn((fn: (x: WebsiteData) => WebsiteData) => { d = fn(d); });
    const onEditText = jest.fn();
    const onChangeImage = jest.fn();
    let tree: any;
    const draw = () => act(() => { tree = create(<PageSectionsSheet visible data={d} page={{ key: 'first-visit' }} title="First visit" onChange={onChange} onEditText={onEditText} onChangeImage={onChangeImage} onOpenSource={jest.fn()} onClose={jest.fn()} />); });
    draw();
    expect(texts(tree)).toContain('Heading');
    expect(texts(tree)).toContain('Always shown');
    act(() => { byLabel(tree, 'Change image: Photo')[0].props.onPress(); });
    expect(onChangeImage).toHaveBeenCalledWith('extraPages.images.first-visit');
    expect(texts(tree)).toContain('Sample photo — replace with yours');
    const editBtn = tree.root.findAll((n: any) => /^Edit text: /.test(n.props?.accessibilityLabel ?? '') && typeof n.props?.onPress === 'function')[0];
    act(() => { editBtn.props.onPress(); });
    expect(onEditText).toHaveBeenCalledWith(expect.stringMatching(/^copy\.first-visit\./));
    const sw = tree.root.findAll((n: any) => n.props?.accessibilityLabel === 'Show Book button' && typeof n.props?.onValueChange === 'function')[0];
    act(() => { sw.props.onValueChange(false); });
    expect(d.pageSections?.['first-visit']?.hidden).toEqual(['cta']);
    act(() => { byLabel(tree, 'Move Book button up')[0].props.onPress(); });
    expect(d.pageSections?.['first-visit']?.order).toContain('cta');
  });

  test('a service page lists the guide texts under About this service', async () => {
    const d = await shop({ extraPages: ALL as never });
    const i = d.services.findIndex((s) => s.title === 'Skin fade');
    let tree: any;
    act(() => { tree = create(<PageSectionsSheet visible data={d} page={{ key: 'services', index: i }} title="Skin fade" onChange={jest.fn()} onEditText={jest.fn()} onChangeImage={jest.fn()} onOpenSource={jest.fn()} onClose={jest.fn()} />); });
    expect(texts(tree)).toContain('About this service');
    const guide = tree.root.findAll((n: any) => /^Edit text: Service guide: Fade/.test(n.props?.accessibilityLabel ?? '') && typeof n.props?.onPress === 'function');
    expect(guide.length).toBeGreaterThan(0);
  });

  test('a warning shows when every section is hidden', async () => {
    const { SECTION_IDS } = require('@/web/lib/render/sections');
    const { setSectionHidden } = require('@/lib/pageSections');
    let d = await shop({ extraPages: { ...ALL, on: ['faq'] } as never });
    for (const id of SECTION_IDS.faq.filter((x: string) => x !== 'cta')) d = setSectionHidden(d, 'faq', id, true);
    let tree: any;
    act(() => { tree = create(<PageSectionsSheet visible data={d} page={{ key: 'faq' }} title="FAQ" onChange={jest.fn()} onEditText={jest.fn()} onChangeImage={jest.fn()} onOpenSource={jest.fn()} onClose={jest.fn()} />); });
    expect(texts(tree)).toContain('Every section of this page is hidden. Show one to get this page');
  });
});

describe('text editor for library text', () => {
  test('Reset and Try other wording close the sheet; the note shows for the barber\'s own text', () => {
    const reset = jest.fn();
    const other = jest.fn();
    const onClose = jest.fn();
    let tree: any;
    act(() => {
      tree = create(
        <EditSheet visible path="copy.faq.book" label="How do I book?" value="Mine." note="This text no longer updates with your prices."
          actions={[{ title: 'Reset to suggested', onPress: reset }, { title: 'Try other wording', onPress: other }]} onSave={jest.fn()} onClose={onClose} />,
      );
    });
    expect(texts(tree)).toContain('This text no longer updates with your prices.');
    const btn = (title: string) => tree.root.findAll((n: any) => n.props?.accessibilityRole === 'button' && typeof n.props?.onPress === 'function' && n.findAll?.((c: any) => c.props?.children === title).length > 0).pop();
    act(() => { btn('Try other wording').props.onPress(); });
    expect(other).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalled();
    act(() => { btn('Reset to suggested').props.onPress(); });
    expect(reset).toHaveBeenCalledTimes(1);
  });
});

describe('page hero photo', () => {
  test('the sheet offers gallery photos first, the phone, and the sample only when a photo is set', async () => {
    const d = await shop({ extraPages: ALL as never, gallery: ['https://cdn.example.com/g1.jpg'] });
    const own = { ...d, services: d.services.map((s, i) => (i === 0 ? { ...s, imageUrl: 'https://cdn.example.com/a.jpg' } : s)) } as WebsiteData;
    const onGallery = jest.fn();
    const onSample = jest.fn();
    const onPhone = jest.fn();
    let tree: any;
    act(() => { tree = create(<HeroPhotoSheet visible data={own} path="services.0.imageUrl" onPhone={onPhone} onGallery={onGallery} onSample={onSample} onClose={jest.fn()} />); });
    act(() => { byLabel(tree, 'Use gallery photo 1')[0].props.onPress(); });
    expect(onGallery).toHaveBeenCalledWith('https://cdn.example.com/g1.jpg');
    expect(texts(tree)).toContain('Use sample photo');
    let bare: any;
    act(() => { bare = create(<HeroPhotoSheet visible data={d} path="services.0.imageUrl" onPhone={onPhone} onGallery={onGallery} onSample={onSample} onClose={jest.fn()} />); });
    expect(texts(bare)).not.toContain('Use sample photo');
  });
});

describe('Pages widget as the page picker', () => {
  async function widget(current: any, extra: Record<string, unknown> = {}) {
    const d = await shop({});
    const onSave = jest.fn(); const onClose = jest.fn(); const onEditPage = jest.fn();
    let tree: any;
    act(() => { tree = create(<PagesSheet visible data={d} current={current} currentTitle="Services" onEditPage={onEditPage} onSave={onSave} onClose={onClose} {...extra} />); });
    return { onSave, onClose, onEditPage, tree };
  }

  test('shows the current page, highlights it, and opens the service level on a service page', async () => {
    const m = await widget({ key: 'services', index: 1 });
    expect(texts(m.tree)).toContain('Showing: Services');
    expect(byLabel(m.tree, 'Show Skin fade')[0]).toBeTruthy(); // services group opened on a service page
    expect(byLabel(m.tree, 'Services')[0].props.accessibilityState.selected).toBe(false);
  });

  test('selecting a page switches the preview to it and closes', async () => {
    const m = await widget({ key: 'home' });
    act(() => { byLabel(m.tree, 'Services')[0].props.onPress(); });
    expect(m.onSave).toHaveBeenCalledWith(expect.anything(), { key: 'services' });
    expect(m.onClose).toHaveBeenCalled();
  });

  test('Edit this page is offered only when the page has sections, and closes then edits', async () => {
    const m = await widget({ key: 'home' });
    act(() => { byLabel(m.tree, 'Edit this page')[0].props.onPress(); });
    expect(m.onEditPage).toHaveBeenCalledTimes(1);
    expect(m.onClose).toHaveBeenCalled();
    const n = await widget({ key: 'home' }, { onEditPage: undefined });
    expect(byLabel(n.tree, 'Edit this page')).toHaveLength(0);
  });
});
