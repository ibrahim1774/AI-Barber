import * as ImagePicker from 'expo-image-picker';
import { uploadPhoto } from '@/lib/photos';
import { moveToCover, pickProductPhotos, removePhoto } from '@/lib/store/photos';

jest.mock('@/lib/photos', () => ({ uploadPhoto: jest.fn() }));

const lib = ImagePicker.launchImageLibraryAsync as jest.Mock;
const cam = ImagePicker.launchCameraAsync as jest.Mock;
const perm = ImagePicker.requestCameraPermissionsAsync as jest.Mock;
const upload = uploadPhoto as jest.Mock;

beforeEach(() => {
  jest.resetAllMocks();
  upload.mockImplementation(async (uri: string) => `https://cdn/${uri}`);
});

describe('pickProductPhotos', () => {
  it('asks the library for at most `remaining` photos and uploads in pick order', async () => {
    lib.mockResolvedValue({ canceled: false, assets: [{ uri: 'a' }, { uri: 'b' }] });
    const urls = await pickProductPhotos('library', 3, 'shop1');
    expect(lib).toHaveBeenCalledWith(expect.objectContaining({ allowsMultipleSelection: true, selectionLimit: 3 }));
    expect(upload.mock.calls).toEqual([['a', 'ab-products/shop1'], ['b', 'ab-products/shop1']]);
    expect(urls).toEqual(['https://cdn/a', 'https://cdn/b']);
  });
  it('a camera permission denial is a friendly error and uploads nothing', async () => {
    perm.mockResolvedValue({ granted: false });
    await expect(pickProductPhotos('camera', 5, 'shop1')).rejects.toThrow(/Camera access is off/);
    expect(cam).not.toHaveBeenCalled();
    expect(upload).not.toHaveBeenCalled();
  });
  it('takes a camera photo once permitted', async () => {
    perm.mockResolvedValue({ granted: true });
    cam.mockResolvedValue({ canceled: false, assets: [{ uri: 'c' }] });
    expect(await pickProductPhotos('camera', 5, 'shop1')).toEqual(['https://cdn/c']);
  });
  it('keeps the photos that uploaded and reports how many failed', async () => {
    lib.mockResolvedValue({ canceled: false, assets: [{ uri: 'a' }, { uri: 'b' }, { uri: 'c' }] });
    upload.mockImplementation(async (uri: string) => {
      if (uri === 'b') throw new Error('network');
      return `https://cdn/${uri}`;
    });
    const onFailed = jest.fn();
    expect(await pickProductPhotos('library', 5, 'shop1', undefined, onFailed)).toEqual(['https://cdn/a', 'https://cdn/c']);
    expect(onFailed).toHaveBeenCalledWith(1, 3);
  });
  it('throws when every upload fails', async () => {
    lib.mockResolvedValue({ canceled: false, assets: [{ uri: 'a' }] });
    upload.mockRejectedValue(new Error('network'));
    await expect(pickProductPhotos('library', 5, 'shop1')).rejects.toThrow('network');
  });
  it('a cancelled pick is []', async () => {
    lib.mockResolvedValue({ canceled: true, assets: null });
    expect(await pickProductPhotos('library', 5, 'shop1')).toEqual([]);
    expect(upload).not.toHaveBeenCalled();
  });
  it('does nothing when the strip is full', async () => {
    expect(await pickProductPhotos('library', 0, 'shop1')).toEqual([]);
    expect(lib).not.toHaveBeenCalled();
  });
});

describe('photo list helpers', () => {
  it('moves a photo to the cover', () => {
    expect(moveToCover(['a', 'b', 'c'], 2)).toEqual(['c', 'a', 'b']);
    expect(moveToCover(['a', 'b'], 0)).toEqual(['a', 'b']);
  });
  it('removes a photo', () => {
    expect(removePhoto(['a', 'b', 'c'], 1)).toEqual(['a', 'c']);
  });
});
