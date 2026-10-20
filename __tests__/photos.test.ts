import { api, ApiError } from '@/lib/api';
import { uploadPhoto, pickAndUploadPhoto } from '@/lib/photos';
import * as manip from 'expo-image-manipulator';
import * as picker from 'expo-image-picker';

const m = manip as any;
const FOLDER = 'ios-drafts/abc';

const okFetch = (status = 200) =>
  jest.fn(async (url: string, _init?: any) => {
    if (url.startsWith('file:')) return { blob: async () => 'BLOB' } as any;
    return { ok: status < 300, status } as any;
  });

beforeEach(() => {
  m.__reset();
  (picker.launchImageLibraryAsync as jest.Mock).mockReset();
  jest.spyOn(api, 'getUploadUrls').mockImplementation(async (_f, names) =>
    names.map((n) => ({
      filename: n,
      signedUrl: `https://signed.example/${n}?sig=1`,
      publicUrl: `https://storage.googleapis.com/b/${FOLDER}/${n}`,
    })),
  );
});
afterEach(() => jest.restoreAllMocks());

describe('uploadPhoto', () => {
  it('resizes a large image, uploads with image/jpeg, returns the public URL', async () => {
    m.__setImage({ width: 4000, height: 3000 });
    const fetchFn = okFetch();
    const url = await uploadPhoto('file:///in.heic', FOLDER, { fetchFn: fetchFn as any });

    expect(m.__calls.resize).toEqual([{ width: 2048 }]);
    expect(m.__calls.saveAsync).toEqual([{ format: 'jpeg', compress: 0.8 }]);
    const [name] = (api.getUploadUrls as jest.Mock).mock.calls[0][1];
    expect(name).toMatch(/^\d+-[a-z0-9]{6}\.jpg$/);
    expect((api.getUploadUrls as jest.Mock).mock.calls[0][0]).toBe(FOLDER);

    const put = fetchFn.mock.calls.find((c) => c[0].startsWith('https://signed'))! as any[];
    expect(put[1].method).toBe('PUT');
    expect(put[1].headers).toEqual({ 'Content-Type': 'image/jpeg' });
    expect(put[1].body).toBe('BLOB');
    expect(url).toBe(`https://storage.googleapis.com/b/${FOLDER}/${name}`);
  });

  it('resizes by height when portrait is taller than 2048', async () => {
    m.__setImage({ width: 3000, height: 4000 });
    await uploadPhoto('file:///in.jpg', FOLDER, { fetchFn: okFetch() as any });
    expect(m.__calls.resize).toEqual([{ height: 2048 }]);
  });

  it('does not resize when the long edge is within 2048', async () => {
    m.__setImage({ width: 2048, height: 1500 });
    await uploadPhoto('file:///in.jpg', FOLDER, { fetchFn: okFetch() as any });
    expect(m.__calls.resize).toEqual([]);
    expect(m.__calls.saveAsync).toHaveLength(1);
  });

  it('throws when the PUT fails', async () => {
    await expect(uploadPhoto('file:///in.jpg', FOLDER, { fetchFn: okFetch(403) as any })).rejects.toThrow(/upload/i);
  });

  it('throws when the PUT has a network error', async () => {
    const fetchFn = jest.fn(async (url: string) => {
      if (url.startsWith('file:')) return { blob: async () => 'B' } as any;
      throw new TypeError('Network request failed');
    });
    await expect(uploadPhoto('file:///in.jpg', FOLDER, { fetchFn: fetchFn as any })).rejects.toThrow(/upload/i);
  });

  it('propagates ApiError from getUploadUrls', async () => {
    (api.getUploadUrls as jest.Mock).mockRejectedValue(new ApiError(500, 'x', 'boom'));
    await expect(uploadPhoto('file:///in.jpg', FOLDER, { fetchFn: okFetch() as any })).rejects.toBeInstanceOf(ApiError);
  });
});

describe('pickAndUploadPhoto', () => {
  it('returns null when cancelled', async () => {
    (picker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({ canceled: true, assets: null });
    expect(await pickAndUploadPhoto(FOLDER)).toBeNull();
    expect(api.getUploadUrls).not.toHaveBeenCalled();
  });

  it('launches an images-only single picker and uploads the pick', async () => {
    (picker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///p.jpg', width: 1000, height: 800 }],
    });
    const fetchFn = okFetch();
    const orig = global.fetch;
    global.fetch = fetchFn as any;
    try {
      const url = await pickAndUploadPhoto(FOLDER);
      expect(url).toMatch(/^https:\/\/storage\.googleapis\.com\//);
    } finally {
      global.fetch = orig;
    }
    expect(picker.launchImageLibraryAsync).toHaveBeenCalledWith({
      mediaTypes: ['images'],
      allowsMultipleSelection: false,
      base64: false,
    });
  });
});
