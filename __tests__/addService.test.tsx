import React from 'react';
jest.mock('@/constants/theme', () => require('./store/themeMock'));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));
const mockInject = jest.fn();
let mockProps: any = null;
jest.mock('react-native-webview', () => {
  const R = require('react');
  return { WebView: R.forwardRef((props: any, ref: any) => { mockProps = props; R.useImperativeHandle(ref, () => ({ injectJavaScript: mockInject })); return null; }) };
});
import SitePreview from '@/components/SitePreview';
import { ServicesSheet } from '@/components/sections/ServicesSheet';
import { buildPreviewHtml } from '@/lib/editable';
import { parsePreviewMessage } from '@/lib/previewBridge';
import { shop } from './pagesV2Fixture';
import type { TemplateId, WebsiteData } from '@/web/types';

const { act, create } = require('react-test-renderer');
const ATTR = 'data-ab-add-service';
const designs: TemplateId[] = ['luxe', 'prime', 'euphoria'];
const msg = (o: unknown) => ({ nativeEvent: { data: JSON.stringify(o) } });
const MULTI = { order: ['home', 'services', 'about', 'contact'], hidden: [] } as never;

describe('Add a service: preview injection', () => {
  test.each(designs)('%s: button inside the Services section when there are services', async (t) => {
    const d = await shop({ template: t, pages: undefined });
    const html = buildPreviewHtml(d, true);
    expect(html.split(ATTR)).toHaveLength(2);
    const sec = html.indexOf('<section id="services"');
    expect(html.indexOf(ATTR)).toBeGreaterThan(sec);
    expect(html.indexOf(ATTR)).toBeLessThan(html.indexOf('</section>', sec));
    expect(html).toContain('+ Add a service');
  });

  test.each(designs)('%s: no services -> editor-only placeholder with the button, no services section', async (t) => {
    const d = await shop({ template: t, services: [], pages: undefined });
    const html = buildPreviewHtml(d, true);
    expect(html).not.toContain('<section id="services"');
    expect(html.split(ATTR)).toHaveLength(2);
    expect(html).toContain('Your services will show here');
    expect(html).toMatch(/<section data-ab-editor-only/);
  });

  test.each(designs)('%s: multi-page without services: placeholder on Home only', async (t) => {
    const d = await shop({ template: t, services: [], pages: MULTI });
    expect(buildPreviewHtml(d, true, null, { key: 'home' })).toContain(ATTR);
    expect(buildPreviewHtml(d, true, null, { key: 'about' })).not.toContain(ATTR);
  });

  test.each(designs)('%s: multi-page Services page gets the button, a service detail page does not', async (t) => {
    const d = await shop({ template: t, pages: MULTI });
    expect(buildPreviewHtml(d, true, null, { key: 'services' })).toContain(ATTR);
    expect(buildPreviewHtml(d, true, null, { key: 'services', index: 0 })).not.toContain(ATTR);
  });

  test.each(designs)('%s: never in non-editable output, never carries data-edit', async (t) => {
    for (const services of [undefined, []]) for (const pages of [undefined, MULTI]) {
      const d = await shop({ template: t, pages, ...(services ? { services } : {}) } as Partial<WebsiteData>);
      for (const page of [undefined, { key: 'services' as const }]) {
        const plain = buildPreviewHtml(d, false, null, page);
        expect(plain).not.toContain(ATTR);
        expect(plain).not.toContain('Add a service');
        expect(plain).not.toContain('data-ab-editor-only');
      }
      const ed = buildPreviewHtml(d, true);
      const injected = ed.match(/<(div|section) data-ab-editor-only[\s\S]*?<\/button>/g) ?? [];
      expect(injected.length).toBeGreaterThan(0);
      for (const piece of injected) expect(piece).not.toContain('data-edit');
      // Removing the injected pieces leaves the page free of the control.
      let rest = ed;
      for (const piece of injected) rest = rest.replace(piece, '');
      expect(rest).not.toContain(ATTR);
    }
  });
});

describe('Add a service: bridge', () => {
  test('addService is whitelisted exactly; unknown types and extra shapes are rejected', async () => {
    const d = await shop({});
    expect(parsePreviewMessage(JSON.stringify({ type: 'addService' }), d)).toEqual({ type: 'addService' });
    for (const bad of [{ type: 'addservice' }, { type: 'add_service' }, { type: 'removeService' }, { type: 'addService ' }, { type: 5 }, [], 'x']) {
      expect(parsePreviewMessage(JSON.stringify(bad), d)).toBeNull();
    }
    expect(parsePreviewMessage('{not json', d)).toBeNull();
  });

  test('SitePreview calls onAddService only when editable', async () => {
    const d = await shop({});
    const onAdd = jest.fn();
    act(() => { create(<SitePreview data={d} editable onEditText={jest.fn()} onEditImage={jest.fn()} onAddService={onAdd} />); });
    act(() => { mockProps.onMessage(msg({ type: 'addService' })); });
    expect(onAdd).toHaveBeenCalledTimes(1);
    const off = jest.fn();
    act(() => { create(<SitePreview data={d} editable={false} onEditText={jest.fn()} onEditImage={jest.fn()} onAddService={off} />); });
    act(() => { mockProps.onMessage(msg({ type: 'addService' })); });
    expect(off).not.toHaveBeenCalled();
  });
});

describe('Add a service: sheet', () => {
  const texts = (tree: any) => tree.root.findAll((n: any) => n.type === 'Text').map((n: any) => [].concat(n.props.children).join(''));
  const mount = (props: any) => {
    let tree: any;
    act(() => { tree = create(<ServicesSheet visible data={props.data} onChange={props.onChange} onClose={jest.fn()} upload={jest.fn()} startAdd={props.startAdd} />); });
    return tree;
  };

  test('startAdd opens at the add view (library + own); without it the list shows', async () => {
    const d = await shop({});
    expect(texts(mount({ data: d, onChange: jest.fn(), startAdd: true }))).toContain('Add your own');
    expect(texts(mount({ data: d, onChange: jest.fn() }))).not.toContain('Add your own');
  });

  test('adding a library service through it updates the site data', async () => {
    const d = await shop({ services: [] });
    let data = d;
    const onChange = jest.fn((u: (x: WebsiteData) => WebsiteData) => { data = u(data); });
    const tree = mount({ data: d, onChange, startAdd: true });
    const chip = tree.root.find((n: any) => typeof n.props?.onPress === 'function' && n.findAll((c: any) => c.type === 'Text' && [].concat(c.props.children).join('') === 'Skin fade').length > 0);
    act(() => { chip.props.onPress(); });
    expect(data.services.map((s) => s.title)).toContain('Skin fade');
  });
});
