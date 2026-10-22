/**
 * Honest sites, editor: the preview renders what the published page renders (old invented copy removed
 * before the editor markers go in; prices through displayPrice / serviceMeta), the sample-photo nudge,
 * and services editing with an optional price.
 */
import React from 'react';
import { allText, render } from '../store/render';

jest.mock('@/constants/theme', () => require('../store/themeMock'));

import { generateContent } from '@/web/services/geminiService';
import { isStockImage } from '@/web/lib/stockImages';
import type { WebsiteData } from '@/web/types';
import { StockPhotoNudge } from '@/components/StockPhotoNudge';
import { buildPreviewHtml, getPath, setPath, stripMarkers } from '@/lib/editable';
import { STOCK_NUDGE, editorRecord, stockPhotoPaths } from '@/lib/editor';
import { renderSite, forRender, withImages } from '@/lib/render';
import { addService, newService, removeService, serviceRowMeta, updateService } from '@/lib/sections/services';
import { toShopSite } from '@/lib/importer';

const booksy = require('../fixtures/scrape-booksy.json');

/** A site saved before honest sites: the old about heading, tagline and filler description, a price repeated in the subtitle. */
async function legacySite(template: 'luxe' | 'prime' | 'euphoria' = 'luxe'): Promise<WebsiteData> {
  const d = await generateContent({ shopName: 'Fresh Cuts', area: 'Brooklyn, NY', phone: '555', template });
  return {
    ...d,
    template,
    hero: { ...d.hero, tagline: 'Premium grooming, considered every step.' },
    about: { ...d.about, heading: 'Built around the cut.' },
    services: [{ title: 'Haircut', subtitle: '30 min · $25', price: '25', description: 'Book ahead — same care every visit.', icon: 'scissors', imageUrl: '' }],
  };
}

describe('the preview matches the published page', () => {
  it.each(['luxe', 'prime', 'euphoria'] as const)('%s: no old invented copy in the editable preview; the price shows once as "$25"', async (t) => {
    const d = await legacySite(t);
    const preview = stripMarkers(buildPreviewHtml(d, true));
    for (const old of ['Built around the cut.', 'Premium grooming, considered every step.', 'Book ahead — same care every visit.', '30 min · $25']) {
      expect(preview).not.toContain(old);
    }
    expect(preview).toContain('$25');
    // The published render of the same data drops the same copy.
    const published = withImages(renderSite(forRender(d)), d);
    for (const old of ['Built around the cut.', 'Book ahead — same care every visit.']) expect(published).not.toContain(old);
  });

  it('editorRecord edits the cleaned data; an already-clean record is returned as is', async () => {
    const rec = { draftId: 'd', data: await legacySite() } as any;
    const shown = editorRecord(rec);
    expect(shown.data.about.heading).not.toBe('Built around the cut.');
    expect(shown.data.services[0].description).toBe('');
    expect(editorRecord(shown)).toBe(shown);
  });

  it('serviceRowMeta: price once through displayPrice, then the length', () => {
    expect(serviceRowMeta({ price: '25', subtitle: '30 min · $25', duration: '30 min' })).toBe('$25  ·  30 min');
    expect(serviceRowMeta({ price: '$25', subtitle: '$25' })).toBe('$25');
    expect(serviceRowMeta({ price: '', subtitle: '', duration: '45 min' })).toBe('45 min');
    expect(serviceRowMeta({ price: 'from $30' })).toBe('from $30');
    expect(serviceRowMeta({})).toBe('');
  });
});

let stockPhotoPathsOfGenerated = 0;
describe('sample-photo nudge', () => {
  beforeAll(async () => {
    stockPhotoPathsOfGenerated = stockPhotoPaths(await generateContent({ shopName: 'X', area: '', phone: '' })).length;
  });

  it('a generated site shows sample photos; replacing every one clears the nudge', async () => {
    let d = await generateContent({ shopName: 'Fresh Cuts', area: '', phone: '' });
    const stock = stockPhotoPaths(d);
    expect(stock.length).toBeGreaterThan(0);
    stock.forEach((p, i) => {
      d = setPath(d, p, `https://cdn.example/own-${i}.jpg`);
    });
    expect(stockPhotoPaths(d)).toEqual([]);
  });

  it('a booking-page import: its own photos never count as samples', () => {
    const { site } = toShopSite(booksy, '', 'booking');
    expect((booksy.photos as string[]).some((u) => isStockImage(u))).toBe(false);
    for (const p of stockPhotoPaths(site)) expect(booksy.photos).not.toContain(getPath(site, p));
    expect(stockPhotoPaths(site).length).toBeLessThan(stockPhotoPathsOfGenerated);
  });

  it('the nudge: one line and an "Add photos" action', async () => {
    const onAdd = jest.fn();
    const tree = await render(<StockPhotoNudge onAddPhotos={onAdd} />);
    expect(allText(tree)).toEqual([STOCK_NUDGE, 'Add photos']);
    expect(STOCK_NUDGE).toBe('These are sample photos. Add your own so customers see your work.');
    tree.root.findAll((n: any) => n.props?.accessibilityLabel === 'Add photos' && n.props.onPress)[0].props.onPress();
    expect(onAdd).toHaveBeenCalledTimes(1);
  });
});

describe('services editing in the app editor (optional price)', () => {
  it('add, price, clear the price, edit, remove', async () => {
    let d = await generateContent({ shopName: 'Fresh Cuts', area: '', phone: '' });
    expect(d.services).toEqual([]);
    d = addService(d, newService('Skin fade', 45, 'scissors'));
    d = updateService(d, 0, { title: 'Skin fade', price: '30', duration: 45, description: '', imageUrl: '' });
    expect(d.services[0].price).toBe('$30');
    expect(serviceRowMeta(d.services[0])).toBe('$30  ·  45 min');
    d = updateService(d, 0, { title: 'Skin fade', price: '', duration: 45, description: '', imageUrl: '' });
    expect(d.services[0].price).toBeUndefined();
    expect(serviceRowMeta(d.services[0])).toBe('45 min');
    d = addService(d, newService('Beard trim', 15, 'razor'));
    d = removeService(d, 0);
    expect(d.services.map((s) => s.title)).toEqual(['Beard trim']);
    // The page shows the service with no price line.
    const html = stripMarkers(buildPreviewHtml({ ...d, template: 'luxe' }, true));
    expect(html).toContain('Beard trim');
  });
});
