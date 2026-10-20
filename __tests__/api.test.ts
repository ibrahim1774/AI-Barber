import { api, ApiError } from '@/lib/api';

const mockFetch = jest.fn();
beforeEach(() => {
  mockFetch.mockReset();
  (global as any).fetch = mockFetch;
});

const res = (status: number, body: unknown, raw = false) => ({
  ok: status >= 200 && status < 300,
  status,
  text: async () => (raw ? String(body) : JSON.stringify(body)),
});

describe('api', () => {
  it('maps 422 to ApiError with the server message', async () => {
    mockFetch.mockResolvedValue(res(422, { error: 'No shop found at that link' }));
    const err = await api.importScrape('https://booksy.com/x').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(422);
    expect(err.code).toBe('No shop found at that link');
    expect(err.message).toBe('No shop found at that link');
  });

  it('uses the web fallback copy for 5xx with an HTML body and http-<status> code', async () => {
    mockFetch.mockResolvedValue(res(504, '<html>timeout</html>', true));
    const err = await api.importScrape('https://booksy.com/x').catch((e) => e);
    expect(err.status).toBe(504);
    expect(err.code).toBe('http-504');
    expect(err.message).toMatch(/took too long/);
  });

  it('turns network failures into code network with status 0', async () => {
    mockFetch.mockRejectedValue(new TypeError('Network request failed'));
    const err = await api.iosSite('tx1').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.code).toBe('network');
    expect(err.status).toBe(0);
  });

  it('turns an abort into code network', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    mockFetch.mockRejectedValue(abort);
    const err = await api.importBusiness('https://x').catch((e) => e);
    expect(err.code).toBe('network');
    expect(err.status).toBe(0);
  });

  it('getUploadUrls posts siteId=folder and filenames', async () => {
    const urls = [{ filename: 'a.jpg', signedUrl: 's', publicUrl: 'p' }];
    mockFetch.mockResolvedValue(res(200, { urls }));
    const out = await api.getUploadUrls('folder-1', ['a.jpg']);
    expect(out).toEqual(urls);
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://www.aibarber.org/api/get-upload-urls');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ siteId: 'folder-1', filenames: ['a.jpg'] });
  });

  it('iosPublish posts the body unchanged and returns server error codes', async () => {
    const body = { transactionId: 't', siteData: { hero: {} } as any };
    mockFetch.mockResolvedValueOnce(res(402, { error: 'subscription-inactive' }));
    const err = await api.iosPublish(body).catch((e) => e);
    expect(err.status).toBe(402);
    expect(err.code).toBe('subscription-inactive');
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual(body);
  });

  it('iosSite returns the 404 no-site code', async () => {
    mockFetch.mockResolvedValue(res(404, { error: 'no-site' }));
    const err = await api.iosSite('t').catch((e) => e);
    expect(err.code).toBe('no-site');
    expect(err.status).toBe(404);
  });

  it('findBusiness posts query and near', async () => {
    mockFetch.mockResolvedValue(res(200, { candidates: [], searchedNear: 'Brooklyn, NY' }));
    const out = await api.findBusiness('Kings', 'Brooklyn, NY');
    expect(out.searchedNear).toBe('Brooklyn, NY');
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ query: 'Kings', near: 'Brooklyn, NY' });
  });

  it('deleteAccount sends the bearer token', async () => {
    mockFetch.mockResolvedValue(res(200, { deleted: true }));
    await expect(api.deleteAccount('tok')).resolves.toBeUndefined();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://www.aibarber.org/api/ios/delete-account');
    expect(init.headers.Authorization).toBe('Bearer tok');
  });

  it('deleteAccount surfaces 401', async () => {
    mockFetch.mockResolvedValue(res(401, { error: 'unauthorized' }));
    const err = await api.deleteAccount('bad').catch((e) => e);
    expect(err.status).toBe(401);
    expect(err.code).toBe('unauthorized');
  });
});
