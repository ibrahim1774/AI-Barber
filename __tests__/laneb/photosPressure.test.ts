import { api } from '@/lib/api';
import { pickAndUploadPhoto, uploadPhoto } from '@/lib/photos';
import { moveToCover, pickProductPhotos, removePhoto } from '@/lib/store/photos';
import { clearGalleryPhoto, gallerySlots, setGalleryPhoto } from '@/lib/sections/gallery';
import * as manip from 'expo-image-manipulator';
import * as picker from 'expo-image-picker';

const m = manip as any;
const p = picker as any;
const FOLDER = 'ios-drafts/x';
const okFetch = (status = 200) =>
  jest.fn(async (url: string) => (url.startsWith('file:') ? ({ blob: async () => 'B' } as any) : ({ ok: status < 300, status } as any)));
beforeEach(() => {
  m.__reset();
  p.launchImageLibraryAsync.mockReset(); p.launchCameraAsync.mockReset(); p.requestCameraPermissionsAsync.mockReset();
  jest.spyOn(api, 'getUploadUrls').mockImplementation(async (_f, names) =>
    names.map((n) => ({ filename: n, signedUrl: `https://s.example/${n}`, publicUrl: `https://cdn.example/${FOLDER}/${n}` })));
});
afterEach(() => jest.restoreAllMocks());

describe('replace / cancel / permission (single photo)', () => {
  it('cancel returns null and never uploads', async () => {
    p.launchImageLibraryAsync.mockResolvedValue({ canceled: true, assets: null });
    expect(await pickAndUploadPhoto(FOLDER)).toBeNull();
    expect(api.getUploadUrls).not.toHaveBeenCalled();
  });
  it('empty assets array without canceled flag is treated as cancel', async () => {
    p.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [] });
    expect(await pickAndUploadPhoto(FOLDER)).toBeNull();
  });
  it('library permission denied: the picker rejects and the error reaches the caller (no silent null)', async () => {
    p.launchImageLibraryAsync.mockRejectedValue(new Error('Photo library permission denied'));
    await expect(pickAndUploadPhoto(FOLDER)).rejects.toThrow(/permission/i);
  });
  it('replace: a second pick yields a different URL (names are unique per upload)', async () => {
    p.launchImageLibraryAsync.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///a.jpg' }] });
    const f = okFetch(); (global as any).fetch = f;
    const a = await pickAndUploadPhoto(FOLDER); const b = await pickAndUploadPhoto(FOLDER);
    expect(a).not.toBe(b);
  });
  it('onPicked is not called on cancel', async () => {
    p.launchImageLibraryAsync.mockResolvedValue({ canceled: true });
    const cb = jest.fn(); await pickAndUploadPhoto(FOLDER, cb); expect(cb).not.toHaveBeenCalled();
  });
});

describe('oversize / odd formats', () => {
  it.each([
    ['huge landscape', 8000, 1000, { width: 2048 }],
    ['huge portrait', 1000, 8000, { height: 2048 }],
    ['panorama', 12000, 500, { width: 2048 }],
    ['exactly 2048', 2048, 1500, undefined],
    ['2049 square', 2049, 2049, { width: 2048 }],
    ['tiny 1x1', 1, 1, undefined],
  ])('%s', async (_n, w, h, resize) => {
    m.__setImage({ width: w, height: h });
    await uploadPhoto('file:///x.heic', FOLDER, { fetchFn: okFetch() as any });
    expect(m.__calls.resize).toEqual(resize ? [resize] : []);
    expect(m.__calls.saveAsync[0]).toEqual({ format: 'jpeg', compress: 0.8 });
  });
  it.each(['file:///a.HEIC', 'file:///a.png', 'file:///a.gif', 'file:///a.webp', 'file:///noext', 'file:///a b%20c.jpg'])('%s is always sent as image/jpeg', async (uri) => {
    const f = okFetch(); await uploadPhoto(uri, FOLDER, { fetchFn: f as any });
    const put = f.mock.calls.find((c: any[]) => c[0].startsWith('https://s.')) as any[];
    expect(put[1].headers['Content-Type']).toBe('image/jpeg');
  });
  it('a corrupt file (manipulator throws) surfaces an error, nothing is uploaded', async () => {
    jest.spyOn(m.ImageManipulator, 'manipulate').mockImplementation(() => { throw new Error('bad image'); });
    await expect(uploadPhoto('file:///bad.jpg', FOLDER, { fetchFn: okFetch() as any })).rejects.toThrow();
    expect(api.getUploadUrls).not.toHaveBeenCalled();
  });
  it.each([403, 413, 500])('upload status %i gives the friendly retry message', async (s) => {
    await expect(uploadPhoto('file:///a.jpg', FOLDER, { fetchFn: okFetch(s) as any })).rejects.toThrow(/Photo upload failed.*Check your connection/);
  });
  it('no upload URL returned', async () => {
    (api.getUploadUrls as jest.Mock).mockResolvedValue([]);
    await expect(uploadPhoto('file:///a.jpg', FOLDER, { fetchFn: okFetch() as any })).rejects.toThrow(/no upload URL/);
  });
  it('network drop during PUT is wrapped', async () => {
    const f = jest.fn(async (u: string) => { if (u.startsWith('file:')) return { blob: async () => 'B' } as any; throw new TypeError('Network request failed'); });
    await expect(uploadPhoto('file:///a.jpg', FOLDER, { fetchFn: f as any })).rejects.toThrow(/Network request failed/);
  });
});

describe('product photos: add / remove / reorder / permission', () => {
  const lib = (n: number) => ({ canceled: false, assets: Array.from({ length: n }, (_, i) => ({ uri: `file:///${i}.jpg` })) });
  beforeEach(() => { (global as any).fetch = okFetch(); });
  it('camera permission denied throws the Settings message and never opens the camera', async () => {
    p.requestCameraPermissionsAsync.mockResolvedValue({ granted: false });
    await expect(pickProductPhotos('camera', 5, 'shop')).rejects.toThrow(/Camera access is off/);
    expect(p.launchCameraAsync).not.toHaveBeenCalled();
  });
  it('camera cancel returns []', async () => {
    p.requestCameraPermissionsAsync.mockResolvedValue({ granted: true });
    p.launchCameraAsync.mockResolvedValue({ canceled: true });
    expect(await pickProductPhotos('camera', 5, 'shop')).toEqual([]);
  });
  it('library cancel returns [] and does not call onPicked', async () => {
    p.launchImageLibraryAsync.mockResolvedValue({ canceled: true });
    const cb = jest.fn(); expect(await pickProductPhotos('library', 5, 'shop', cb)).toEqual([]); expect(cb).not.toHaveBeenCalled();
  });
  it('no room left (remaining 0 or negative) opens nothing', async () => {
    expect(await pickProductPhotos('library', 0, 's')).toEqual([]);
    expect(await pickProductPhotos('library', -1, 's')).toEqual([]);
    expect(p.launchImageLibraryAsync).not.toHaveBeenCalled();
  });
  it('picker returning more than remaining is cut to remaining', async () => {
    p.launchImageLibraryAsync.mockResolvedValue(lib(9));
    expect(await pickProductPhotos('library', 3, 's')).toHaveLength(3);
  });
  it('one of three uploads fails: two kept, onFailed(1,3)', async () => {
    p.launchImageLibraryAsync.mockResolvedValue(lib(3));
    let n = 0;
    (global as any).fetch = jest.fn(async (u: string) => (u.startsWith('file:') ? { blob: async () => 'B' } : { ok: ++n !== 2, status: n === 2 ? 500 : 200 }));
    const failed = jest.fn();
    expect(await pickProductPhotos('library', 5, 's', undefined, failed)).toHaveLength(2);
    expect(failed).toHaveBeenCalledWith(1, 3);
  });
  it('all uploads fail: throws', async () => {
    p.launchImageLibraryAsync.mockResolvedValue(lib(2));
    (global as any).fetch = jest.fn(async (u: string) => (u.startsWith('file:') ? { blob: async () => 'B' } : { ok: false, status: 500 }));
    await expect(pickProductPhotos('library', 5, 's')).rejects.toThrow(/Photo upload failed/);
  });
  it('remove last photo leaves []; remove out-of-range is a no-op copy', () => {
    expect(removePhoto(['a'], 0)).toEqual([]);
    expect(removePhoto(['a', 'b'], 5)).toEqual(['a', 'b']);
    expect(removePhoto(['a', 'b'], -1)).toEqual(['a', 'b']);
  });
  it('cover/reorder keeps every photo exactly once', () => {
    expect(moveToCover(['a', 'b', 'c'], 2)).toEqual(['c', 'a', 'b']);
    expect(moveToCover(['a', 'b', 'c'], 0)).toEqual(['a', 'b', 'c']);
    expect(moveToCover(['a'], 3)).toEqual(['a']);
    expect(moveToCover([], 0)).toEqual([]);
  });
});

describe('site gallery slots', () => {
  const d = (o: any = {}) => ({ gallery: [], ...o }) as any;
  it('luxe 2..7, prime 0..5, euphoria grows past last filled', () => {
    expect(gallerySlots(d())).toEqual([2, 3, 4, 5, 6, 7]);
    expect(gallerySlots(d({ template: 'prime' }))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(gallerySlots(d({ template: 'euphoria' }))).toHaveLength(8);
    const g = Array(10).fill(''); g[9] = 'u';
    expect(gallerySlots(d({ template: 'euphoria', gallery: g }))).toHaveLength(11);
  });
  it('add pads earlier slots with empty strings; clear keeps indices; remove-last empties', () => {
    let x = setGalleryPhoto(d(), 4, 'u4');
    expect(x.gallery).toEqual(['', '', '', '', 'u4']);
    x = clearGalleryPhoto(x, 4);
    expect(x.gallery).toEqual(['', '', '', '', '']);
  });
  it('replace overwrites in place; empty url on set is ignored (no accidental delete)', () => {
    let x = setGalleryPhoto(d({ gallery: ['', '', 'old'] }), 2, 'new');
    expect(x.gallery[2]).toBe('new');
    const same = setGalleryPhoto(x, 2, '');
    expect(same).toBe(x);
  });
  it('slots outside the design are refused, input not mutated', () => {
    const src = d({ gallery: ['a'] });
    expect(setGalleryPhoto(src, 0, 'u')).toBe(src); // luxe 0 feeds hero
    expect(clearGalleryPhoto(src, 1)).toBe(src);
    expect(src.gallery).toEqual(['a']);
  });
});
