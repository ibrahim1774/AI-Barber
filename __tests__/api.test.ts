import { api, ApiError } from '@/lib/api';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { sb } = require('@/lib/supabase');

const mockFetch = jest.fn();
beforeEach(() => {
  mockFetch.mockReset();
  sb.reset();
  sb.setSession({ access_token: 'tok-1', user: { id: 'u1' } });
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

  it('never shows a raw server code or a 5xx server string to the user', async () => {
    mockFetch.mockResolvedValue(res(500, { error: 'e2e-internal' }));
    const err = await api.importScrape('https://booksy.com/x').catch((e) => e);
    expect(err.code).toBe('e2e-internal');
    expect(err.message).not.toMatch(/e2e-internal/);
    expect(err.message).toMatch(/took too long/);

    mockFetch.mockResolvedValue(res(502, { error: 'Upstream exploded: ECONNRESET at db-3' }));
    const e2 = await api.importScrape('https://booksy.com/x').catch((e) => e);
    expect(e2.message).not.toMatch(/ECONNRESET/);
  });

  it('replaces a slug-style 4xx code with friendly copy but keeps the code', async () => {
    mockFetch.mockResolvedValue(res(400, { error: 'bad-request' }));
    const err = await api.iosPublish({ transactionId: 't', siteData: {} as any }, 'tok').catch((e) => e);
    expect(err.code).toBe('bad-request');
    expect(err.message).toBe("Couldn't do that right now. Try again in a moment.");
    mockFetch.mockResolvedValue(res(429, { error: 'rate_limited' }));
    const e2 = await api.importScrape('https://x').catch((e) => e);
    expect(e2.message).toBe("Couldn't do that right now. Try again in a moment.");
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
    const err = await api.iosPublish(body, 'tok-1').catch((e) => e);
    expect(err.status).toBe(402);
    expect(err.code).toBe('subscription-inactive');
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual(body);
  });

  it('iosPublish always sends the Bearer', async () => {
    mockFetch.mockResolvedValueOnce(res(200, { siteId: 's', deployedUrl: 'u', republished: false }));
    await api.iosPublish({ transactionId: 't', siteData: {} as any }, 'tok-9');
    expect(mockFetch.mock.calls[0][1].headers).toMatchObject({ Authorization: 'Bearer tok-9' });
  });

  it('iosSite sends the signed-in Bearer on the request itself', async () => {
    mockFetch.mockResolvedValue(res(200, { siteId: 's', deployedUrl: null, siteData: null, active: true }));
    await api.iosSite('tx-1');
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://www.aibarber.org/api/ios/site');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer tok-1' });
  });

  it('iosSite signed out never reaches the network: 401 auth-required', async () => {
    sb.setSession(null);
    const err = await api.iosSite('tx-1').catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 401, code: 'auth-required' });
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('iosSite keeps the 409 purchase-other-account hint in the error body', async () => {
    mockFetch.mockResolvedValue(res(409, { error: 'purchase-other-account', hint: 'a***@gmail.com' }));
    const err = await api.iosSite('tx-1').catch((e) => e);
    expect(err).toMatchObject({ status: 409, code: 'purchase-other-account', body: { hint: 'a***@gmail.com' } });
  });

  it('claimStart and signup post their bodies; signup surfaces the server field and code', async () => {
    mockFetch.mockResolvedValueOnce(res(200, { ok: true, state: 'unclaimed', claimExpiresAt: 'x' }));
    await api.claimStart('tx-7');
    expect(mockFetch.mock.calls[0][0]).toBe('https://www.aibarber.org/api/ios/claim-start');
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ transactionId: 'tx-7' });
    mockFetch.mockResolvedValueOnce(res(400, { error: 'bad-request', field: 'phone' }));
    const bad = await api.signup({ name: 'A', email: 'a@b.co', phone: '1', password: 'x'.repeat(8), transactionId: 'tx-7' }).catch((e) => e);
    expect(bad).toMatchObject({ status: 400, code: 'bad-request', body: { field: 'phone' } });
    mockFetch.mockResolvedValueOnce(res(409, { error: 'email-exists' }));
    expect(await api.signup({ name: 'A', email: 'a@b.co', phone: '+15550100199', password: 'x'.repeat(8), transactionId: 'tx-7' }).catch((e) => e)).toMatchObject({ status: 409, code: 'email-exists' });
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

  it('takeSiteOffline posts the transaction id, with a bearer only when given', async () => {
    mockFetch.mockResolvedValue(res(200, { removed: true }));
    await expect(api.takeSiteOffline('tx-9')).resolves.toBeUndefined();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://www.aibarber.org/api/ios/take-offline');
    expect(JSON.parse(init.body)).toEqual({ transactionId: 'tx-9' });
    expect(init.headers.Authorization).toBeUndefined();
    await api.takeSiteOffline('tx-9', 'tok');
    expect(mockFetch.mock.calls[1][1].headers.Authorization).toBe('Bearer tok');
  });

  it('takeSiteOffline sends expectedSlug when given (the server answers 409 on a mismatch)', async () => {
    mockFetch.mockResolvedValue(res(200, { removed: true }));
    await api.takeSiteOffline('tx-9', 'tok', 'fade');
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ transactionId: 'tx-9', expectedSlug: 'fade' });
    mockFetch.mockResolvedValue(res(409, { error: 'site-mismatch' }));
    const err = await api.takeSiteOffline('tx-9', null, 'other').catch((e) => e);
    expect(err.status).toBe(409);
    expect(err.code).toBe('site-mismatch');
  });

  it('takeSiteOffline surfaces 403 sign-in-required', async () => {
    mockFetch.mockResolvedValue(res(403, { error: 'sign-in-required' }));
    const err = await api.takeSiteOffline('tx-9').catch((e) => e);
    expect(err.status).toBe(403);
    expect(err.code).toBe('sign-in-required');
  });

  it('deleteAccount surfaces 401', async () => {
    mockFetch.mockResolvedValue(res(401, { error: 'unauthorized' }));
    const err = await api.deleteAccount('bad').catch((e) => e);
    expect(err.status).toBe(401);
    expect(err.code).toBe('unauthorized');
  });

  it('aborts after the timeout and reports code network', async () => {
    jest.useFakeTimers();
    try {
      mockFetch.mockImplementation(
        (_u: string, init: any) =>
          new Promise((_r, reject) => {
            init.signal.addEventListener('abort', () =>
              reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
            );
          }),
      );
      const p = api.iosSite('t').catch((e) => e);
      await jest.advanceTimersByTimeAsync(30_001);
      const err = await p;
      expect(err).toBeInstanceOf(ApiError);
      expect(err.code).toBe('network');
      expect(err.status).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('maps a 200 with a non-JSON body to bad-response', async () => {
    mockFetch.mockResolvedValue(res(200, '<html>oops</html>', true));
    const err = await api.importScrape('https://booksy.com/x').catch((e) => e);
    expect(err.code).toBe('bad-response');
    expect(err.status).toBe(200);
  });
});
