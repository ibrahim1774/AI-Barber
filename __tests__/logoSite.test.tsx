import React from 'react';
jest.mock('@/constants/theme', () => require('./store/themeMock'));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
import { generateContent } from '@/web/services/geminiService';
import type { WebsiteData } from '@/web/types';
import { renderSite, forRender, withImages } from '@/lib/render';
import { withLogo, withoutLogo, withLogoPreview } from '@/lib/logo';
import { publishPayload } from '@/lib/publish';
import { buildPreviewHtml, previewEditPaths } from '@/lib/editable';
import { HeaderSheet } from '@/components/HeaderSheet';
import { PhotosSheet } from '@/components/AllFieldsSheet';

const { act, create } = require('react-test-renderer');

let base: WebsiteData;
beforeAll(async () => {
  base = await generateContent({ shopName: 'Fresh Cuts', area: 'Brooklyn, NY', phone: '555-0100' });
});
const LOGO = { url: 'https://storage.googleapis.com/b/ios-drafts/abc/logo/1-abcdef.png', w: 600, h: 300 };
const DATA_URI = 'data:image/png;base64,QUJD';

describe('site data and payload', () => {
  it('a site without a logo has no logo key anywhere in the payload', () => {
    expect('logo' in base).toBe(false);
    expect('logo' in publishPayload(base)).toBe(false);
    expect(JSON.stringify(publishPayload(base))).not.toContain('"logo"');
  });

  it('a set logo is sent as exactly {url,w,h}', () => {
    const d = withLogo(base, { ...LOGO, extra: 1 } as any);
    expect(publishPayload(d).logo).toEqual(LOGO);
  });

  it('removing the logo deletes the field and restores the no-logo payload', () => {
    const removed = withoutLogo(withLogo(base, LOGO));
    expect('logo' in removed).toBe(false);
    expect(publishPayload(removed)).toEqual(publishPayload(base));
    expect(withoutLogo(base)).toBe(base);
  });

  it('a data URI can never reach the payload (it would be blanked, not sent)', () => {
    const d = withLogoPreview(withLogo(base, LOGO), { url: LOGO.url, dataUri: DATA_URI });
    expect(d.logo!.url).toBe(DATA_URI);
    expect(publishPayload(d).logo!.url).toBe('');
    // ...and the saved data is untouched by the preview swap.
    expect(withLogo(base, LOGO).logo!.url).toBe(LOGO.url);
    expect(withLogoPreview(withLogo(base, LOGO), { url: 'https://other', dataUri: DATA_URI }).logo!.url).toBe(LOGO.url);
    expect(withLogoPreview(base, { url: LOGO.url, dataUri: DATA_URI })).toBe(base);
  });
});

describe('preview', () => {
  it('shopName stays an editable path with a logo, so a tap on the logo is accepted by the bridge', () => {
    expect(previewEditPaths(withLogo(base, LOGO))).toContain('shopName');
  });

  it('shows the logo image from the https URL, and from the data URI right after an upload', () => {
    const d = withLogo(base, LOGO);
    for (const tpl of ['luxe', 'prime', 'euphoria'] as const) {
      const t = { ...d, template: tpl };
      expect(withImages(renderSite(forRender(t)), t)).toContain(`src="${LOGO.url}"`);
      const p = withLogoPreview(t, { url: LOGO.url, dataUri: DATA_URI });
      const html = withImages(renderSite(forRender(p)), p);
      expect(html).toContain(`src="${DATA_URI}"`);
      expect(html).toMatch(/<img src="data:image\/png;base64,QUJD" alt="Fresh Cuts" width="600" height="300" fetchpriority="high"/);
    }
  });

  it('only a PNG data URI in the logo slot is allowed; other data: values stay blocked', () => {
    const hero = { ...base, hero: { ...base.hero, imageUrl: DATA_URI } };
    expect(withImages('<img src="{{hero}}">', hero)).toBe('<img src="">');
    const evil = withLogoPreview(withLogo(base, LOGO), { url: LOGO.url, dataUri: 'data:image/svg+xml;base64,AAAA' });
    expect(withImages(renderSite(forRender(evil)), evil)).not.toContain('data:image/svg');
  });

  it('a site without a logo renders the shop name header with no logo markup', () => {
    const html = withImages(renderSite(forRender(base)), base);
    expect(html).not.toContain('fetchpriority="high"');
    expect(buildPreviewHtml(base, true)).not.toContain('fetchpriority="high"');
    expect(buildPreviewHtml(withLogo(base, LOGO), true)).toContain(`src="${LOGO.url}" alt="Fresh Cuts" width="600" height="300" fetchpriority="high"`);
  });
});

function mountHeader(over: Record<string, unknown> = {}) {
  const props: any = {
    visible: true, data: base, uploading: false, error: null,
    onEditName: jest.fn(), onPickLogo: jest.fn(), onRemoveLogo: jest.fn(), onClose: jest.fn(), ...over,
  };
  let tree: any;
  act(() => { tree = create(<HeaderSheet {...props} />); });
  const texts = () => tree.root.findAll((n: any) => n.type === 'Text').map((n: any) => [].concat(n.props.children).join(''));
  const press = (title: string) => {
    const b = tree.root.find((n: any) => typeof n.props?.onPress === 'function' && n.findAll((c: any) => c.type === 'Text' && [].concat(c.props.children).join('') === title).length > 0);
    act(() => { b.props.onPress(); });
  };
  const tab = (label: string) => {
    const t = tree.root.find((n: any) => n.props?.accessibilityRole === 'tab' && n.props?.accessibilityLabel === label);
    act(() => { t.props.onPress(); });
  };
  return { props, tree, texts, press, tab };
}

describe('HeaderSheet states', () => {
  it('none: opens on Name; the Logo tab offers Add your logo only', () => {
    const m = mountHeader();
    expect(m.texts()).toContain('Fresh Cuts');
    expect(m.texts()).toContain('Edit shop name');
    m.press('Edit shop name');
    expect(m.props.onEditName).toHaveBeenCalled();
    m.tab('Logo');
    expect(m.texts()).toContain('Add your logo');
    expect(m.texts()).not.toContain('Remove logo');
    m.press('Add your logo');
    expect(m.props.onPickLogo).toHaveBeenCalled();
  });

  it('uploading: shows progress and no actions', () => {
    const m = mountHeader({ uploading: true, startOn: 'logo' });
    expect(m.texts()).toContain('Uploading logo…');
    expect(m.texts()).not.toContain('Add your logo');
  });

  it('error: shows the reason and keeps Add your logo for a retry (site unchanged)', () => {
    const m = mountHeader({ startOn: 'logo', error: "Couldn't open that image" });
    expect(m.texts()).toContain("Couldn't open that image");
    expect(m.texts()).toContain('Add your logo');
    m.press('Add your logo');
    expect(m.props.onPickLogo).toHaveBeenCalled();
  });

  it('set: opens on Logo with Replace and Remove', () => {
    const m = mountHeader({ data: withLogo(base, LOGO), previewUri: DATA_URI });
    expect(m.texts()).toContain('Replace logo');
    expect(m.texts()).toContain('Remove logo');
    expect(m.texts()).not.toContain('Add your logo');
    m.press('Replace logo');
    expect(m.props.onPickLogo).toHaveBeenCalled();
    m.press('Remove logo');
    expect(m.props.onRemoveLogo).toHaveBeenCalled();
  });

  it('removed: back to the name, Add your logo offered again', () => {
    const m = mountHeader({ data: withoutLogo(withLogo(base, LOGO)), startOn: 'logo' });
    expect(m.texts()).toContain('Add your logo');
    expect(m.texts()).not.toContain('Remove logo');
  });
});

describe('PhotosSheet Logo row', () => {
  it('shows a Logo tile that opens the logo editor; absent without onLogo', () => {
    const onLogo = jest.fn();
    let tree: any;
    act(() => { tree = create(<PhotosSheet visible data={base} onPick={jest.fn()} onLogo={onLogo} onClose={jest.fn()} />); });
    const tile = tree.root.find((n: any) => n.props?.accessibilityLabel === 'Change Logo' && typeof n.props.onPress === 'function');
    act(() => { tile.props.onPress(); });
    expect(onLogo).toHaveBeenCalled();
    act(() => { tree.update(<PhotosSheet visible data={base} onPick={jest.fn()} onClose={jest.fn()} />); });
    expect(tree.root.findAll((n: any) => n.props?.accessibilityLabel === 'Change Logo')).toHaveLength(0);
  });
});
