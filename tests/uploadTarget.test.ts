import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from 'vitest';

// The public image endpoints wrote `${siteId}/${filename}` anywhere in the bucket, including
// pending-sites/{slug}.json (an app site's stored copy, which a sweep restore or admin
// republish deploys). Same severity as C1; fixed in the same hotfix.
const { saved, exists, signed } = vi.hoisted(() => ({
  saved: vi.fn(async (_path: string, _buf: unknown, _opts: any) => {}),
  exists: vi.fn(async (_path: string) => false),
  signed: vi.fn(async (_path: string) => 'https://signed.example/put'),
}));
vi.mock('@google-cloud/storage', () => ({
  Storage: class {
    bucket() {
      return {
        file: (path: string) => ({
          save: (buf: unknown, opts: any) => saved(path, buf, opts),
          exists: async () => [await exists(path)],
          getSignedUrl: async () => [await signed(path)],
        }),
      };
    }
  },
}));

// api/get-upload-urls reads its credentials at module load, before the imports below run.
vi.hoisted(() => {
  process.env.GCP_SERVICE_ACCOUNT_JSON = JSON.stringify({ project_id: 'p' });
  process.env.GCS_BUCKET_NAME = 'bkt';
});

afterAll(() => {
  delete process.env.GCP_SERVICE_ACCOUNT_JSON;
  delete process.env.GCS_BUCKET_NAME;
});

import { imageFilename, imageFolder } from '../lib/uploadTarget.js';
import uploadImage from '../api/upload-image.js';
import getUploadUrls from '../api/get-upload-urls.js';

const mkRes = () => { const res: any = { setHeader: vi.fn(), status: vi.fn().mockReturnThis(), json: vi.fn(), end: vi.fn() }; return res; };
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

describe('imageFolder / imageFilename', () => {
  it('accepts the folders real callers use', () => {
    expect(imageFolder('fresh-cuts')).toBe('fresh-cuts');
    expect(imageFolder('3f2b8c1e-5d4a-4b6f-9e2d-1a2b3c4d5e6f')).toBe('3f2b8c1e-5d4a-4b6f-9e2d-1a2b3c4d5e6f');
    expect(imageFolder('ios-drafts/3f2b8c1e-5d4a-4b6f-9e2d-1a2b3c4d5e6f')).toBe('ios-drafts/3f2b8c1e-5d4a-4b6f-9e2d-1a2b3c4d5e6f');
    expect(imageFolder('ab-products/shop_123')).toBe('ab-products/shop_123');
  });
  it('refuses the server\'s own prefixes, traversal, empty and odd segments', () => {
    for (const bad of ['pending-sites', 'Pending-Sites', 'pending-sites-history/x', 'admin-republish-runs', '../x', 'a/../b', '', '/x', 'x/', 'a b', 'a/b/c/d', '.hidden', 42, null]) {
      expect(imageFolder(bad)).toBeNull();
    }
  });
  it('accepts image names the clients generate; refuses anything else', () => {
    expect(imageFilename('hero-1730000000000.jpg')).toBe('hero-1730000000000.jpg');
    expect(imageFilename('gallery-0-1730000000000.jpg')).toBe('gallery-0-1730000000000.jpg');
    expect(imageFilename('1730000000000-ab12cd.jpg')).toBe('1730000000000-ab12cd.jpg');
    for (const bad of ['fade-lab.json', 'x/hero.jpg', '../hero.jpg', '.jpg', 'hero.jpg.json', 'hero', '', 7]) {
      expect(imageFilename(bad)).toBeNull();
    }
  });
});

describe('api/upload-image', () => {
  beforeEach(() => { saved.mockReset().mockResolvedValue(undefined); });
  afterEach(() => vi.restoreAllMocks());

  it('refuses a write into pending-sites (the app site\'s stored copy) → 400, nothing saved', async () => {
    const res = mkRes();
    await uploadImage({ method: 'POST', body: { siteId: 'pending-sites', filename: 'fade-lab.json', base64: 'data:image/jpeg;base64,e30=' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(saved).not.toHaveBeenCalled();
  });

  it('refuses a non-image body → 400', async () => {
    const res = mkRes();
    await uploadImage({ method: 'POST', body: { siteId: 'fresh-cuts', filename: 'hero-1.jpg', base64: 'data:application/json;base64,e30=' } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(saved).not.toHaveBeenCalled();
  });

  it('a normal upload saves with a no-overwrite precondition and returns the public URL', async () => {
    const res = mkRes();
    await uploadImage({ method: 'POST', body: { siteId: 'fresh-cuts', filename: 'hero-1.jpg', base64: PNG } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ publicUrl: 'https://storage.googleapis.com/bkt/fresh-cuts/hero-1.jpg' });
    expect(saved).toHaveBeenCalledWith('fresh-cuts/hero-1.jpg', expect.anything(), expect.objectContaining({
      contentType: 'image/png', preconditionOpts: { ifGenerationMatch: 0 },
    }));
  });

  it('an existing object is never replaced → 409', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    saved.mockRejectedValueOnce(Object.assign(new Error('precondition'), { code: 412 }));
    const res = mkRes();
    await uploadImage({ method: 'POST', body: { siteId: 'fresh-cuts', filename: 'hero-1.jpg', base64: PNG } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
  });
});

describe('api/get-upload-urls', () => {
  beforeEach(() => { exists.mockReset().mockResolvedValue(false); signed.mockClear(); });

  it('refuses a signed URL into pending-sites → 400, nothing signed', async () => {
    const res = mkRes();
    await getUploadUrls({ method: 'POST', body: { siteId: 'pending-sites', filenames: ['fade-lab.json'] } }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    const res2 = mkRes();
    await getUploadUrls({ method: 'POST', body: { siteId: 'ios-drafts/x', filenames: ['../../pending-sites/fade-lab.json'] } }, res2);
    expect(res2.status).toHaveBeenCalledWith(400);
    expect(signed).not.toHaveBeenCalled();
  });

  it('the iOS app\'s request still works', async () => {
    const res = mkRes();
    await getUploadUrls({ method: 'POST', body: { siteId: 'ios-drafts/abc-123', filenames: ['1730000000000-ab12cd.jpg'] } }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ urls: [{
      filename: '1730000000000-ab12cd.jpg', signedUrl: 'https://signed.example/put',
      publicUrl: 'https://storage.googleapis.com/bkt/ios-drafts/abc-123/1730000000000-ab12cd.jpg',
    }] });
  });

  it('a name that already exists (a live site\'s image) is refused → 409', async () => {
    exists.mockResolvedValue(true);
    const res = mkRes();
    await getUploadUrls({ method: 'POST', body: { siteId: 'fresh-cuts', filenames: ['hero-1.jpg'] } }, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(signed).not.toHaveBeenCalled();
  });
});
