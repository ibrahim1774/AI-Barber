import { api, ApiError } from '@/lib/api';
import { uploadLogo, pickAndUploadLogo, LogoError, LOGO_DECODE_MESSAGE, LOGO_UPLOAD_MESSAGE } from '@/lib/photos';
import * as manip from 'expo-image-manipulator';
import * as picker from 'expo-image-picker';
import UPNG from 'upng-js';

const m = manip as any;
// The contrast check makes its own 48 px copy; these assertions are about the uploaded one.
const uploadResizes = () => m.__calls.resize.filter((r: any) => r.width !== 48 && r.height !== 48);
const FOLDER = 'ios-drafts/abc';

// size: bytes of the saved file as the first and second save report them.
const fetchWith = (sizes: number[], putStatus = 200) => {
  let i = 0;
  return jest.fn(async (url: string, _init?: any) => {
    if (url.startsWith('file:')) return { blob: async () => ({ size: sizes[Math.min(i++, sizes.length - 1)] }) } as any;
    return { ok: putStatus < 300, status: putStatus } as any;
  });
};

beforeEach(() => {
  m.__reset();
  (picker.launchImageLibraryAsync as jest.Mock).mockReset();
  jest.spyOn(api, 'getUploadUrls').mockImplementation(async (_f, names) =>
    names.map((n) => ({ filename: n, signedUrl: `https://signed.example/${n}?sig=1`, publicUrl: `https://storage.googleapis.com/b/${FOLDER}/logo/${n}` })),
  );
});
afterEach(() => jest.restoreAllMocks());

describe('uploadLogo', () => {
  it('shrinks to 600px, saves PNG, uploads as image/png kind logo and returns url, size and a data URI', async () => {
    m.__setImage({ width: 2000, height: 1000 });
    const fetchFn = fetchWith([50_000]);
    const out = await uploadLogo('file:///in.heic', FOLDER, { fetchFn: fetchFn as any });

    expect(uploadResizes()).toEqual([{ width: 600 }]);
    expect(m.__calls.saveAsync[0]).toEqual({ format: 'png', base64: true });
    const call = (api.getUploadUrls as jest.Mock).mock.calls[0];
    expect(call[0]).toBe(FOLDER);
    expect(call[1][0]).toMatch(/^\d+-[a-z0-9]{6}\.png$/);
    expect(call[2]).toEqual({ contentType: 'image/png', kind: 'logo' });
    const put = fetchFn.mock.calls.find((c) => c[0].startsWith('https://signed'))! as any[];
    expect(put[1].method).toBe('PUT');
    expect(put[1].headers).toEqual({ 'Content-Type': 'image/png' });
    expect(out).toEqual({ url: `https://storage.googleapis.com/b/${FOLDER}/logo/${call[1][0]}`, w: 600, h: 300, previewUri: 'data:image/png;base64,QUJD', contrast: null });
  });

  it('resizes a tall logo by height and never enlarges a small one', async () => {
    m.__setImage({ width: 500, height: 1500 });
    await uploadLogo('file:///a.png', FOLDER, { fetchFn: fetchWith([1000]) as any });
    expect(uploadResizes()).toEqual([{ height: 600 }]);
    m.__reset();
    m.__setImage({ width: 300, height: 200 });
    const out = await uploadLogo('file:///b.png', FOLDER, { fetchFn: fetchWith([1000]) as any });
    expect(uploadResizes()).toEqual([]);
    expect([out.w, out.h]).toEqual([300, 200]);
  });

  it('saves again at 400px when the file is over 300KB', async () => {
    m.__setImage({ width: 1200, height: 800 });
    const fetchFn = fetchWith([400_000, 120_000]);
    const out = await uploadLogo('file:///big.png', FOLDER, { fetchFn: fetchFn as any });
    expect(uploadResizes()).toEqual([{ width: 600 }, { width: 400 }]);
    expect(m.__calls.saveAsync).toHaveLength(3); // two uploads' encodes + the 48 px contrast copy
    expect([out.w, out.h]).toEqual([400, 267]);
    expect((api.getUploadUrls as jest.Mock).mock.calls).toHaveLength(1);
  });

  it("an image that cannot be decoded says Couldn't open that image and uploads nothing", async () => {
    m.__failRender(new Error('decode'));
    const fetchFn = fetchWith([1]);
    const err = await uploadLogo('file:///x.jpg', FOLDER, { fetchFn: fetchFn as any }).catch((e) => e);
    expect(err).toBeInstanceOf(LogoError);
    expect(err.kind).toBe('decode');
    expect(err.message).toBe(LOGO_DECODE_MESSAGE);
    expect(LOGO_DECODE_MESSAGE).toBe("Couldn't open that image");
    expect(api.getUploadUrls).not.toHaveBeenCalled();
  });

  it('a failed PUT, a network error and a signing error are all a retryable upload error', async () => {
    const bad = await uploadLogo('file:///x.png', FOLDER, { fetchFn: fetchWith([1], 403) as any }).catch((e) => e);
    expect(bad).toMatchObject({ kind: 'upload', message: LOGO_UPLOAD_MESSAGE });

    const net = jest.fn(async (url: string) => {
      if (url.startsWith('file:')) return { blob: async () => ({ size: 1 }) } as any;
      throw new TypeError('Network request failed');
    });
    expect(await uploadLogo('file:///x.png', FOLDER, { fetchFn: net as any }).catch((e) => e)).toMatchObject({ kind: 'upload' });

    (api.getUploadUrls as jest.Mock).mockRejectedValue(new ApiError(500, 'x', 'boom'));
    expect(await uploadLogo('file:///x.png', FOLDER, { fetchFn: fetchWith([1]) as any }).catch((e) => e)).toMatchObject({ kind: 'upload' });
  });
});

describe('pickAndUploadLogo', () => {
  it('returns null on cancel without uploading', async () => {
    (picker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({ canceled: true, assets: null });
    const onPicked = jest.fn();
    expect(await pickAndUploadLogo(FOLDER, onPicked)).toBeNull();
    expect(onPicked).not.toHaveBeenCalled();
    expect(api.getUploadUrls).not.toHaveBeenCalled();
  });

  it('opens an images-only single picker and uploads the pick', async () => {
    (picker.launchImageLibraryAsync as jest.Mock).mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///p.png' }] });
    const orig = global.fetch;
    global.fetch = fetchWith([1000]) as any;
    try {
      const onPicked = jest.fn();
      const out = await pickAndUploadLogo(FOLDER, onPicked);
      expect(onPicked).toHaveBeenCalledTimes(1);
      expect(out?.url).toMatch(/\/logo\/.+\.png$/);
    } finally {
      global.fetch = orig;
    }
    expect(picker.launchImageLibraryAsync).toHaveBeenCalledWith({ mediaTypes: ['images'], allowsMultipleSelection: false, base64: false });
  });
});

describe('api.getUploadUrls body', () => {
  it('a photo request carries no contentType or kind; a logo request does', async () => {
    jest.restoreAllMocks();
    const orig = global.fetch;
    const bodies: any[] = [];
    global.fetch = jest.fn(async (_u: any, init: any) => { bodies.push(JSON.parse(init.body)); return { ok: true, status: 200, json: async () => ({ urls: [] }), text: async () => '{"urls":[]}' } as any; }) as any;
    try {
      await api.getUploadUrls('f', ['a.jpg']);
      await api.getUploadUrls('f', ['a.png'], { contentType: 'image/png', kind: 'logo' });
    } finally {
      global.fetch = orig;
    }
    expect(bodies[0]).toEqual({ siteId: 'f', filenames: ['a.jpg'] });
    expect(bodies[1]).toEqual({ siteId: 'f', filenames: ['a.png'], contentType: 'image/png', kind: 'logo' });
  });
});

describe('uploadLogo without base64', () => {
  it('a missing base64 is a pick failure with the friendly error, not a blank preview, and uploads nothing', async () => {
    const fetchFn = fetchWith([1]);
    m.__omitBase64();
    const err = await uploadLogo('file:///x.jpg', FOLDER, { fetchFn: fetchFn as any }).catch((e) => e);
    expect(err).toBeInstanceOf(LogoError);
    expect(err.message).toBe(LOGO_DECODE_MESSAGE);
    expect(api.getUploadUrls).not.toHaveBeenCalled();
  });
});

describe('uploadLogo contrast', () => {
  // A real 2x2 PNG: opaque black, as the manipulator would return it as base64.
  const png = (rgba: number[]) => Buffer.from(UPNG.encode([new Uint8Array(rgba).buffer], 2, 2, 0)).toString('base64');

  it('decodes a tiny copy and reports low contrast for a black logo; uploads the same bytes as before', async () => {
    m.__setImage({ width: 2000, height: 1000 });
    m.__setSaveBase64(png(new Array(16).fill(0).map((_, i) => (i % 4 === 3 ? 255 : 0))));
    const fetchFn = fetchWith([50_000]);
    const out = await uploadLogo('file:///in.png', FOLDER, { fetchFn: fetchFn as any });
    expect(out.contrast?.verdict).toBe('low');
    expect(m.__calls.resize).toContainEqual({ width: 48 });
    const put = fetchFn.mock.calls.find((c) => c[0].startsWith('https://signed'))! as any[];
    expect(put[1].body).toEqual({ size: 50_000 });
  });
  it('a white logo is ok', async () => {
    m.__setSaveBase64(png(new Array(16).fill(255)));
    expect((await uploadLogo('file:///in.png', FOLDER, { fetchFn: fetchWith([1000]) as any })).contrast?.verdict).toBe('ok');
  });
  it('when decoding throws, the upload still succeeds and contrast is null', async () => {
    const out = await uploadLogo('file:///in.png', FOLDER, { fetchFn: fetchWith([1000]) as any }); // default base64 "ABC" is not a PNG
    expect(out.contrast).toBeNull();
    expect(out.url).toMatch(/^https:/);
  });
  it('when the tiny copy cannot be made, the upload still succeeds with contrast null', async () => {
    m.__setSaveBase64(png(new Array(16).fill(0)));
    m.__failAtEdge(48);
    const out = await uploadLogo('file:///in.png', FOLDER, { fetchFn: fetchWith([1000]) as any });
    expect(out.contrast).toBeNull();
  });
});
