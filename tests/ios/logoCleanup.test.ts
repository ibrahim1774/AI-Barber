// The logo file must survive the photo cleanup: removeSiteLive's URL-derived deletions are limited to
// ios-drafts/<draftId>/<file> photos, and a logo lives one level deeper (<folder>/logo/<file>).
import { describe, it, expect } from 'vitest';
import { draftPhotosToDelete, ourObjectPath, underOwnedPrefix, ownedPrefixes } from '../../lib/ios/removeSiteLive.js';

const B = 'bkt';
const url = (p: string) => `https://storage.googleapis.com/${B}/${p}`;

describe('logo vs photo cleanup', () => {
  it('a draft logo is never a deletion candidate; a draft photo next to it still is', () => {
    const photo = 'ios-drafts/abc-123/1730000000000-ab12cd.jpg';
    const logo = 'ios-drafts/abc-123/logo/1730000000001-ef34.png';
    expect(draftPhotosToDelete([url(photo), url(logo)], B, new Set())).toEqual([photo]);
    expect(draftPhotosToDelete([url(logo)], B, new Set())).toEqual([]);
  });
  it('a logo under a bare draft folder or a slug folder is not a URL-derived deletion either', () => {
    expect(draftPhotosToDelete([url('abc-123/logo/a.png'), url('fresh-cuts/logo/a.png')], B, new Set())).toEqual([]);
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
