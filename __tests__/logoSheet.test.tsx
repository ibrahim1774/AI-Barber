import React, { useState } from 'react';
import fs from 'fs';
import path from 'path';
jest.mock('@/constants/theme', () => require('./store/themeMock'));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
import { generateContent } from '@/web/services/geminiService';
import type { WebsiteData } from '@/web/types';
import { LOGO_BOTH_ENABLED, headerShowOf, withHeaderShow, withLogo, withoutLogo } from '@/lib/logo';
import { savePathValue } from '@/lib/editor';
import { publishPayload } from '@/lib/publish';
import { buildPreviewHtml } from '@/lib/editable';
import { HeaderSheet } from '@/components/HeaderSheet';
import { PhotosSheet } from '@/components/AllFieldsSheet';
import { SectionsSheet } from '@/components/sections/SectionsSheet';

const { act, create } = require('react-test-renderer');

let base: WebsiteData;
beforeAll(async () => {
  base = await generateContent({ shopName: 'Fresh Cuts', area: 'Brooklyn, NY', phone: '555-0100' });
});
const LOGO = { url: 'https://storage.googleapis.com/b/ios-drafts/abc/logo/1-abcdef.png', w: 600, h: 300 };

/** The real sheet wired the way edit.tsx wires it, with the site data held in state so persistence can be read back. */
function mount(initial: () => WebsiteData, extra: Record<string, unknown> = {}) {
  const ref: { data: WebsiteData } = { data: initial() };
  const props: any = { onPickLogo: jest.fn(), onClose: jest.fn() };
  function Harness() {
    const [data, setData] = useState(initial);
    ref.data = data;
    return (
      <HeaderSheet
        visible data={data} uploading={false} error={null}
        onShow={(s) => setData((d) => withHeaderShow(d, s))}
        onSaveName={(t) => setData((d) => savePathValue(d, 'shopName', t))}
        onRemoveLogo={() => setData((d) => withoutLogo(d))}
        onPickLogo={props.onPickLogo} onClose={props.onClose}
        {...extra}
      />
    );
  }
  let tree: any;
  act(() => { tree = create(<Harness />); });
  const byLabel = (l: string) => tree.root.find((n: any) => n.props?.accessibilityLabel === l && typeof n.props.onPress === 'function');
  const texts = () => tree.root.findAll((n: any) => n.type === 'Text').map((n: any) => [].concat(n.props.children).join(''));
  const press = (title: string) => {
    const b = tree.root.find((n: any) => typeof n.props?.onPress === 'function' && n.findAll((c: any) => c.type === 'Text' && [].concat(c.props.children).join('') === title).length > 0);
    act(() => { b.props.onPress(); });
  };
  const input = () => tree.root.find((n: any) => n.props?.accessibilityLabel === 'Shop name' && typeof n.props.onChangeText === 'function');
  return { ref, props, byLabel, texts, press, input, tree };
}
const sel = (m: any, label: string) => !!m.byLabel(label).props.accessibilityState?.selected;
const off = (m: any, label: string) => !!m.byLabel(label).props.accessibilityState?.disabled;

describe('header show helpers', () => {
  it('default is both: no field, and a logo site reads as both', () => {
    const d = withLogo(base, LOGO);
    expect('headerShow' in d).toBe(false);
    expect(headerShowOf(d)).toBe('both');
  });
  it('without a logo the header is the name, whatever headerShow says', () => {
    expect(headerShowOf(base)).toBe('name');
    expect(headerShowOf({ ...base, headerShow: 'logo' })).toBe('name');
  });
  it('both removes the field, never writes "both"; logo and name write it; the logo object is untouched', () => {
    const d = withLogo(base, LOGO);
    const l = withHeaderShow(d, 'logo');
    expect(l.headerShow).toBe('logo');
    expect(l.logo).toEqual(LOGO);
    const n = withHeaderShow(l, 'name');
    expect(n.headerShow).toBe('name');
    expect(n.logo).toEqual(LOGO);
    const b = withHeaderShow(n, 'both');
    expect('headerShow' in b).toBe(false);
    expect(JSON.stringify(b)).not.toContain('"both"');
  });
  it('withLogo keeps an existing headerShow; withoutLogo deletes it', () => {
    const n = withHeaderShow(withLogo(base, LOGO), 'name');
    expect(withLogo(n, { ...LOGO, url: LOGO.url + '2' }).headerShow).toBe('name');
    const r = withoutLogo(n);
    expect('headerShow' in r).toBe(false);
    expect('logo' in r).toBe(false);
  });
  it('the payload never carries a dangling headerShow when there is no logo', () => {
    expect('headerShow' in publishPayload({ ...base, headerShow: 'logo' })).toBe(false);
    const ok = publishPayload(withHeaderShow(withLogo(base, LOGO), 'name'));
    expect(ok.headerShow).toBe('name');
    expect(ok.logo).toEqual(LOGO);
  });
  it('the test build has the three-way choice on', () => {
    expect(LOGO_BOTH_ENABLED).toBe(true);
  });
});

describe('Logo & name sheet', () => {
  it('has the new title, no Name|Logo tabs, and defaults to Logo + name', () => {
    const m = mount(() => withLogo(base, LOGO));
    expect(m.texts()).toContain('Logo & name');
    expect(m.tree.root.findAll((n: any) => n.props?.accessibilityRole === 'tab')).toHaveLength(0);
    expect(sel(m, 'Logo + name')).toBe(true);
    expect(sel(m, 'Logo only')).toBe(false);
    expect(sel(m, 'Name only')).toBe(false);
  });

  it('the three modes persist headerShow correctly, and the logo is never touched', () => {
    const m = mount(() => withLogo(base, LOGO));
    act(() => { m.byLabel('Logo only').props.onPress(); });
    expect(m.ref.data.headerShow).toBe('logo');
    expect(sel(m, 'Logo only')).toBe(true);
    act(() => { m.byLabel('Name only').props.onPress(); });
    expect(m.ref.data.headerShow).toBe('name');
    expect(sel(m, 'Name only')).toBe(true);
    act(() => { m.byLabel('Logo + name').props.onPress(); });
    expect('headerShow' in m.ref.data).toBe(false);
    expect(sel(m, 'Logo + name')).toBe(true);
    expect(m.ref.data.logo).toEqual(LOGO);
  });

  it('Name only keeps the logo url, and the preview shows the name without the image; switching back shows both', () => {
    const m = mount(() => withLogo(base, LOGO));
    act(() => { m.byLabel('Name only').props.onPress(); });
    expect(m.ref.data.logo!.url).toBe(LOGO.url);
    const html = buildPreviewHtml(m.ref.data, true);
    expect(html).toContain('Fresh Cuts');
    expect(html).not.toContain(LOGO.url);
    act(() => { m.byLabel('Logo + name').props.onPress(); });
    const both = buildPreviewHtml(m.ref.data, true);
    expect(both).toContain(LOGO.url);
    expect(both).toContain('Fresh Cuts');
  });

  it('without a logo the logo choices are disabled with a hint, Name only is selected, and pressing them does nothing', () => {
    const m = mount(() => base);
    expect(off(m, 'Logo + name')).toBe(true);
    expect(off(m, 'Logo only')).toBe(true);
    expect(off(m, 'Name only')).toBe(false);
    expect(sel(m, 'Name only')).toBe(true);
    expect(m.texts()).toContain('Add a logo first');
    act(() => { m.byLabel('Logo only').props.onPress(); });
    expect('headerShow' in m.ref.data).toBe(false);
    expect(m.texts()).toContain('Add your logo');
  });

  it('with a logo all three choices are enabled and no hint shows', () => {
    const m = mount(() => withLogo(base, LOGO));
    for (const l of ['Logo + name', 'Logo only', 'Name only']) expect(off(m, l)).toBe(false);
    expect(m.texts()).not.toContain('Add a logo first');
  });

  it('the shop name is edited in place and persists; an empty name is refused', () => {
    const m = mount(() => withLogo(base, LOGO));
    expect(m.input().props.value).toBe('Fresh Cuts');
    act(() => { m.input().props.onChangeText('Sharp Fades'); });
    expect(m.ref.data.shopName).toBe('Sharp Fades');
    act(() => { m.input().props.onChangeText('   '); });
    expect(m.ref.data.shopName).toBe('Sharp Fades');
    act(() => { m.input().props.onBlur(); });
    expect(m.input().props.value).toBe('Sharp Fades');
  });

  it('works for the name with no logo too (name stays editable)', () => {
    const m = mount(() => base);
    act(() => { m.input().props.onChangeText('Clippers'); });
    expect(m.ref.data.shopName).toBe('Clippers');
  });

  it('removing the logo resets the state: field and logo gone, name-only selected, choices disabled, Add offered', () => {
    const m = mount(() => withHeaderShow(withLogo(base, LOGO), 'logo'));
    m.press('Remove logo');
    expect('logo' in m.ref.data).toBe(false);
    expect('headerShow' in m.ref.data).toBe(false);
    expect(sel(m, 'Name only')).toBe(true);
    expect(off(m, 'Logo only')).toBe(true);
    expect(m.texts()).toContain('Add your logo');
  });

  it('replace goes to the picker', () => {
    const m = mount(() => withLogo(base, LOGO));
    m.press('Replace logo');
    expect(m.props.onPickLogo).toHaveBeenCalled();
  });

  it('the dark-logo note still shows under the preview', () => {
    const m = mount(() => withLogo(base, LOGO), { contrast: 'low' });
    expect(m.texts()).toContain('This logo may be hard to see on the header');
  });
});

describe('entry points', () => {
  it('Photos tile and Sections row are labelled Logo & name and call the same opener', () => {
    const open = jest.fn();
    let a: any; let b: any;
    act(() => { a = create(<PhotosSheet visible data={base} onPick={jest.fn()} onLogo={open} onClose={jest.fn()} />); });
    act(() => { b = create(<SectionsSheet visible data={base} onOpen={jest.fn()} onLogo={open} onClose={jest.fn()} />); });
    const tile = a.root.find((n: any) => n.props?.accessibilityLabel === 'Logo & name' && typeof n.props.onPress === 'function');
    const row = b.root.find((n: any) => n.props?.accessibilityLabel === 'Logo & name, Add' && typeof n.props.onPress === 'function');
    act(() => { tile.props.onPress(); row.props.onPress(); });
    expect(open).toHaveBeenCalledTimes(2);
  });

  it.each([
    [undefined, 'Logo + name'],
    ['logo', 'Logo only'],
    ['name', 'Name only'],
  ])('Sections summary for headerShow=%s is %s', (hs, summary) => {
    const d = withLogo(base, LOGO);
    const data = hs ? withHeaderShow(d, hs as any) : d;
    let t: any;
    act(() => { t = create(<SectionsSheet visible data={data} onOpen={jest.fn()} onLogo={jest.fn()} onClose={jest.fn()} />); });
    expect(t.root.findAll((n: any) => n.props?.accessibilityLabel === `Logo & name, ${summary}`).length).toBeGreaterThan(0);
  });

  it('edit.tsx sends the Photos tile, the Sections row and a tap on the header to the one header sheet', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', 'src/app/(tabs)/edit.tsx'), 'utf8');
    expect(src.match(/onLogo=\{LOGO_ENABLED \? openLogo : undefined\}/g)).toHaveLength(2);
    expect(src).toMatch(/path === 'shopName' && LOGO_ENABLED[\s\S]{0,120}setSheet\('header'\)/);
    expect(src).toMatch(/onShow=\{\(s\) => commit\(\(d\) => withHeaderShow\(d, s\)\)\}/);
    expect(src).toMatch(/onSaveName=/);
  });
});
