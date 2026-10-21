import type { WebsiteData } from '@/web/types';
import { addMember, moveMember, removeMember, updateMember } from '@/lib/sections/team';
import { clearGalleryPhoto, gallerySlots, setGalleryPhoto } from '@/lib/sections/gallery';

const site = (extra: Partial<WebsiteData> = {}) => ({ shopName: 'S', gallery: [], ...extra } as WebsiteData);

describe('team', () => {
  const two = site({ staff: [{ name: 'A', role: 'Owner' }, { name: 'B' }] });
  it('adds, keeping the others', () => {
    const out = addMember(two, { name: 'C', role: 'Barber', photo: 'https://x/p.jpg' });
    expect(out.staff).toEqual([{ name: 'A', role: 'Owner' }, { name: 'B' }, { name: 'C', role: 'Barber', photo: 'https://x/p.jpg' }]);
    expect(addMember(site(), { name: 'Z' }).staff).toEqual([{ name: 'Z' }]);
  });
  it('rejects an empty name', () => {
    expect(addMember(two, { name: '  <> ' })).toBe(two);
    expect(updateMember(two, 0, { name: '' })).toBe(two);
  });
  it('cleans text', () => {
    expect(addMember(site(), { name: '<b>Mo</b>', role: 'Fade <i>king' }).staff).toEqual([{ name: 'bMo/b', role: 'Fade iking' }]);
  });
  it('updates, removes and moves', () => {
    expect(updateMember(two, 1, { name: 'B2', role: 'Barber' }).staff).toEqual([{ name: 'A', role: 'Owner' }, { name: 'B2', role: 'Barber' }]);
    expect(removeMember(two, 0).staff).toEqual([{ name: 'B' }]);
    expect(moveMember(two, 0, 1).staff!.map((s) => s.name)).toEqual(['B', 'A']);
    expect(moveMember(two, 0, -1)).toBe(two);
    expect(moveMember(two, 1, 1)).toBe(two);
    expect(removeMember(two, 5)).toBe(two);
  });
});

describe('gallery', () => {
  it("gallerySlots matches the design's rendered indices", () => {
    expect(gallerySlots(site())).toEqual([2, 3, 4, 5, 6, 7]); // luxe GALLERY_PORTFOLIO_INDICES
    expect(gallerySlots(site({ template: 'luxe' }))).toEqual([2, 3, 4, 5, 6, 7]);
    expect(gallerySlots(site({ template: 'prime' }))).toEqual([0, 1, 2, 3, 4, 5]); // prime gallery.slice(0, 6)
  });
  it('clearGalleryPhoto pads so earlier indices are kept', () => {
    const out = clearGalleryPhoto(site({ gallery: ['a', 'b', 'c'] }), 4);
    expect(out.gallery).toEqual(['a', 'b', 'c', '', '']);
  });
  it('clears a filled slot in place', () => {
    expect(clearGalleryPhoto(site({ gallery: ['a', 'b', 'c', 'd'] }), 3).gallery).toEqual(['a', 'b', 'c', '']);
  });
  it('setGalleryPhoto pads and fills', () => {
    expect(setGalleryPhoto(site({ gallery: ['a'] }), 3, 'u').gallery).toEqual(['a', '', '', 'u']);
  });
  it('does not touch slots the design does not render', () => {
    const d = site({ gallery: ['a', 'b'] });
    expect(setGalleryPhoto(d, 0, 'u')).toBe(d);
    expect(clearGalleryPhoto(d, 1)).toBe(d);
    const p = site({ template: 'prime', gallery: ['a'] });
    expect(setGalleryPhoto(p, 0, 'u').gallery).toEqual(['u']);
    expect(setGalleryPhoto(p, 7, 'u')).toBe(p);
  });
  it('euphoria renders every filled slot, so it offers 0..7 and grows with the gallery', () => {
    // euphoria.ts: galleryTiles = every non-empty gallery entry
    expect(gallerySlots(site({ template: 'euphoria' }))).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    const many = site({ template: 'euphoria', gallery: ['a', '', '', '', '', '', '', '', '', 'z'] });
    expect(gallerySlots(many)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(setGalleryPhoto(many, 0, 'u').gallery?.[0]).toBe('u');
    expect(clearGalleryPhoto(many, 9).gallery?.[9]).toBe('');
  });
});
