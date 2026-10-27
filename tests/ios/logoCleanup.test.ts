// The logo file must survive the photo cleanup: removeSiteLive's URL-derived deletions are limited to
// ios-drafts/<draftId>/<file> photos, and a logo lives one level deeper (<folder>/logo/<file>).
import { describe, it, expect } from 'vitest';
import { draftPhotosToDelete, ourObjectPath, underOwnedPrefix, ownedPrefixes } from '../../lib/ios/removeSiteLive.js';

const B = 'bkt';
const url = (p: string) => `https://storage.googleapis.com/${B}/${p}`;

describe('logo vs photo cleanup', () => {
  it('a draft logo is a deletion candidate like a draft photo, unless another site references it', () => {
    const photo = 'ios-drafts/abc-123/1730000000000-ab12cd.jpg';
    const logo = 'ios-drafts/abc-123/logo/1730000000001-ef34.png';
    expect(draftPhotosToDelete([url(photo), url(logo)], B, new Set())).toEqual([photo, logo]);
    expect(draftPhotosToDelete([url(logo)], B, new Set([logo]))).toEqual([]);
  });
  it('only ios-drafts/<id>/logo/<png|jpg|jpeg>: bare-draft, slug, deeper, svg and traversal logos are not URL-derived deletions', () => {
    for (const p of ['abc-123/logo/a.png', 'fresh-cuts/logo/a.png', 'ios-drafts/abc/x/logo/a.png', 'ios-drafts/abc/logo/a.svg', 'ios-drafts/abc/logo/sub/a.png', 'ab-products/abcdefgh/logo/a.png', 'pending-sites/logo/a.png']) {
      expect(draftPhotosToDelete([url(p)], B, new Set()), p).toEqual([]);
    }
    expect(draftPhotosToDelete([url('ios-drafts/abc/logo/../../other/logo/a.png'), url('ios-drafts/abc/logo/a.png?x=1')], B, new Set())).toEqual(['ios-drafts/abc/logo/a.png']);
  });
  it('the logo URL resolves inside our bucket but is not under any prefix of ANOTHER site', () => {
    expect(ourObjectPath(url('ios-drafts/abc-123/logo/a.png'), B)).toBe('ios-drafts/abc-123/logo/a.png');
    expect(underOwnedPrefix('ios-drafts/abc-123/logo/a.png', ownedPrefixes('fresh-cuts'))).toBe(false);
    expect(underOwnedPrefix('other-shop/logo/a.png', ownedPrefixes('fresh-cuts'))).toBe(false);
  });
  it('removing a site removes its own <slug>/logo folder with the rest of the site (intended)', () => {
    expect(underOwnedPrefix('fresh-cuts/logo/a.png', ownedPrefixes('fresh-cuts'))).toBe(true);
  });
});
