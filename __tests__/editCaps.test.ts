import { parsePreviewMessage } from '@/lib/previewBridge';
import { buildPreviewHtml, markData, previewEditPaths, textMaxLength } from '@/lib/editable';
import { dataPathMax } from '@/web/lib/render/editPaths';
import type { WebsiteData } from '@/web/types';

const site = {
  template: 'luxe',
  shopName: 'Fade Lab',
  about: { heading: '', description: [] },
  hero: { heading: 'Sharp cuts', tagline: 'Walk in' },
  services: [{ title: 'Fade', price: '30', duration: '30 min', description: '', category: 'Cuts' }],
  hours: [{ day: 'Monday', open: '09:00', close: '17:00' }],
  contact: { email: 'a@b.co' },
} as unknown as WebsiteData;

const edit = (path: string) => JSON.stringify({ type: 'edit', path });

describe('preview bridge accepts only the current render ids', () => {
  it('accepts a marked path and rejects labels / copy that this render did not mark', () => {
    const paths = previewEditPaths(site);
    expect(paths).toContain('shopName');
    expect(paths).toEqual(Object.values(markData(site).ids));
    expect(parsePreviewMessage(edit('shopName'), site)).toEqual({ type: 'edit', path: 'shopName' });
    for (const bad of ['labels.nonexistentKey', 'labels.', 'copy.guide.fade.what', 'copy.nope', 'bookingUrl', 'hours.9.open']) {
      expect(parsePreviewMessage(edit(bad), site)).toBeNull();
    }
  });

  it('every id the html names is accepted, and a path outside the id map is not', () => {
    const html = buildPreviewHtml(site, true);
    const named = [...html.matchAll(/data-edit="([^"]+)"/g)].map((m) => m[1]);
    expect(named.length).toBeGreaterThan(0);
    for (const p of named) expect(parsePreviewMessage(edit(p), site)).not.toBeNull();
    const ids = previewEditPaths(site);
    const unmarked = 'about.heading';
    expect(ids).not.toContain(unmarked); // empty on this site: nothing to tap
    expect(parsePreviewMessage(edit(unmarked), site)).toBeNull();
  });

  it('uses the caller-supplied list when given', () => {
    expect(parsePreviewMessage(edit('shopName'), site, null, ['phone'])).toBeNull();
    expect(parsePreviewMessage(edit('phone'), site, null, ['phone'])).toEqual({ type: 'edit', path: 'phone' });
  });
});

describe('text caps follow capDataPaths', () => {
  it.each([
    ['hours.0.open', 24], ['hours.0.close', 24], ['staff.2.hours.1.open', 24], ['staff.2.hours.1.close', 24],
    ['services.0.price', 24], ['services.3.duration', 24], ['services.0.category', 40],
    ['contact.email', 120], ['hours.0.day', 20], ['staff.1.hours.0.day', 20],
    ['staff.0.name', 80], ['staff.0.role', 80], ['staff.0.bio', 600],
  ])('%s is capped at %i', (path, max) => {
    expect(dataPathMax(path)).toBe(max);
    expect(textMaxLength(path)).toBe(max);
  });
  it('free-length fields have no cap', () => {
    expect(textMaxLength('hero.heading')).toBeUndefined();
  });
});
