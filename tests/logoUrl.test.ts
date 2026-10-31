import { describe, it, expect } from 'vitest';
import { logoProblem, logoFolderFor, isLogoContentType } from '../lib/logoUrl.js';

const B = 'bkt';
const ok = (over: Record<string, unknown> = {}) => ({ url: `https://storage.googleapis.com/${B}/ios-drafts/abc-123/logo/1730000000000-ab12.png`, w: 600, h: 200, ...over });
const draft = (f: string) => f === 'ios-drafts/abc-123';

describe('logoProblem', () => {
  it('accepts a png and a jpeg in this site\'s logo folder', () => {
    expect(logoProblem(ok(), { bucketName: B, allowFolder: draft })).toBeNull();
    expect(logoProblem(ok({ url: `https://storage.googleapis.com/${B}/ios-drafts/abc-123/logo/x1.jpg` }), { bucketName: B, allowFolder: draft })).toBeNull();
    expect(logoProblem(ok({ url: `https://storage.googleapis.com/${B}/ios-drafts/abc-123/logo/x1.JPEG` }), { bucketName: B, allowFolder: draft })).toBeNull();
  });
  it('shape-only mode (no folder rule) accepts any non-reserved folder', () => {
    expect(logoProblem(ok({ url: `https://storage.googleapis.com/${B}/fresh-cuts/logo/a.png` }), { bucketName: B })).toBeNull();
  });
  it('rejects a URL outside our bucket', () => {
    for (const url of [
      'https://evil.example.com/ios-drafts/abc-123/logo/a.png',
      `https://storage.googleapis.com/other/ios-drafts/abc-123/logo/a.png`,
      `https://storage.googleapis.com.evil.com/${B}/ios-drafts/abc-123/logo/a.png`,
      `http://storage.googleapis.com/${B}/ios-drafts/abc-123/logo/a.png`,
      `data:image/png;base64,AAAA`,
      '', 42, null, undefined,
    ]) expect(logoProblem(ok({ url }), { bucketName: B, allowFolder: draft }), String(url)).not.toBeNull();
  });
  it('rejects another site\'s folder', () => {
    expect(logoProblem(ok({ url: `https://storage.googleapis.com/${B}/ios-drafts/someone-else/logo/a.png` }), { bucketName: B, allowFolder: draft })).not.toBeNull();
    expect(logoProblem(ok({ url: `https://storage.googleapis.com/${B}/other-shop/logo/a.png` }), { bucketName: B, allowFolder: draft })).not.toBeNull();
  });
  it('rejects a path that is not <folder>/logo/<file>, the server\'s own JSON, traversal and query tricks', () => {
    for (const p of [
      'ios-drafts/abc-123/a.png', // not in the logo folder
      'ios-drafts/abc-123/logo/sub/a.png',
      'pending-sites/logo/a.png',
      'pending-sites-history/x/logo/a.png',
      'ios-drafts/abc-123/logo/../../x/logo/a.png',
      'ios-drafts/abc-123/logo/a.png?x=1',
      'ios-drafts/abc-123/logo/a.png#frag',
      'ios-drafts/abc-123/logo/a%2Epng',
      'ios-drafts/abc-123/logo/a.json',
      'ios-drafts/abc-123/logo/a.png.json',
      'ios-drafts/abc-123/logo/',
    ]) expect(logoProblem(ok({ url: `https://storage.googleapis.com/${B}/${p}` }), { bucketName: B }), p).not.toBeNull();
  });
  it('rejects non-png/jpeg files: svg, gif, webp, heic', () => {
    for (const ext of ['svg', 'gif', 'webp', 'heic', 'avif', 'pdf']) {
      expect(logoProblem(ok({ url: `https://storage.googleapis.com/${B}/ios-drafts/abc-123/logo/a.${ext}` }), { bucketName: B, allowFolder: draft }), ext).not.toBeNull();
    }
  });
  it('rejects non-numeric, fractional, zero, negative, huge and absurd-ratio w/h', () => {
    for (const bad of [{ w: '600' }, { w: NaN }, { w: Infinity }, { w: 0 }, { w: -5 }, { w: 600.5 }, { w: 99999 }, { h: null }, { h: undefined }, { h: '1e3' }, { w: 4000, h: 1 }, { w: 1, h: 4000 }]) {
      expect(logoProblem(ok(bad), { bucketName: B, allowFolder: draft }), JSON.stringify(bad)).not.toBeNull();
    }
  });
  it('rejects a non-object logo and fails closed without a bucket name', () => {
    for (const bad of [null, undefined, 'x', 5, [], true]) expect(logoProblem(bad, { bucketName: B })).not.toBeNull();
    expect(logoProblem(ok(), { bucketName: '' })).not.toBeNull();
  });
});

describe('upload helpers', () => {
  it('logoFolderFor adds /logo under a safe, non-reserved site folder only', () => {
    expect(logoFolderFor('ios-drafts/abc-123')).toBe('ios-drafts/abc-123/logo');
    expect(logoFolderFor('fresh-cuts')).toBe('fresh-cuts/logo');
    expect(logoFolderFor('pending-sites')).toBeNull();
    expect(logoFolderFor('../x')).toBeNull();
    expect(logoFolderFor(7)).toBeNull();
  });
  it('only jpeg and png are logo content types', () => {
    expect(isLogoContentType('image/png')).toBe(true);
    expect(isLogoContentType('image/jpeg')).toBe(true);
    for (const bad of ['image/svg+xml', 'image/gif', 'image/webp', 'text/html', 'image/png; charset=x', 'IMAGE/PNG ', 5]) expect(isLogoContentType(bad as any)).toBe(false);
  });
});
