import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../lib/ios/publishFlow.js', () => ({
  liveDeps: vi.fn(() => ({})),
  runIosPublish: vi.fn(async () => ({ status: 200, body: { siteId: 's', deployedUrl: 'https://s.vercel.app', republished: false } })),
  runIosSiteLookup: vi.fn(async () => ({ status: 404, body: { error: 'no-site' } })),
}));

import publishHandler from '../../api/ios/publish.js';
import siteHandler from '../../api/ios/site.js';
import { runIosPublish, runIosSiteLookup } from '../../lib/ios/publishFlow.js';

function res() {
  const r: any = { statusCode: 0, body: undefined, headers: {} as Record<string, string> };
  r.setHeader = (k: string, v: string) => { r.headers[k] = v; return r; };
  r.status = (c: number) => { r.statusCode = c; return r; };
  r.json = (b: unknown) => { r.body = b; return r; };
  r.end = () => r;
  return r;
}

/** Mimics @vercel/node: body is a lazy getter that throws on malformed JSON. */
function badJsonReq(method = 'POST') {
  return Object.defineProperty({ method }, 'body', {
    get() { throw Object.assign(new Error('Invalid JSON'), { statusCode: 400 }); },
  });
}

beforeEach(() => vi.clearAllMocks());

describe.each([
  ['publish', publishHandler, runIosPublish],
  ['site', siteHandler, runIosSiteLookup],
] as const)('api/ios/%s', (_name, handler, flow) => {
  it('OPTIONS → 200 with CORS', async () => {
    const r = res();
    await handler({ method: 'OPTIONS' } as any, r);
    expect(r.statusCode).toBe(200);
    expect(r.headers['Access-Control-Allow-Methods']).toBe('OPTIONS,POST');
    expect(flow).not.toHaveBeenCalled();
  });

  it('GET → 405', async () => {
    const r = res();
    await handler({ method: 'GET', body: {} } as any, r);
    expect(r.statusCode).toBe(405);
    expect(flow).not.toHaveBeenCalled();
  });

  it('malformed JSON (throwing body getter) → 400', async () => {
    const r = res();
    await handler(badJsonReq() as any, r);
    expect(r).toMatchObject({ statusCode: 400, body: { error: 'bad-request' } });
    expect(flow).not.toHaveBeenCalled();
  });

  it('malformed JSON (raw string body) → 400', async () => {
    const r = res();
    await handler({ method: 'POST', body: '{not json' } as any, r);
    expect(r).toMatchObject({ statusCode: 400, body: { error: 'bad-request' } });
    expect(flow).not.toHaveBeenCalled();
  });

  it('valid POST passes the flow result through', async () => {
    const r = res();
    await handler({ method: 'POST', body: JSON.stringify({ transactionId: 't-1', siteData: {} }) } as any, r);
    expect(flow).toHaveBeenCalledTimes(1);
    expect(r.statusCode).toBe((await (flow as any).mock.results[0].value).status);
  });
});

describe('api/ios/site', () => {
  it('forwards the Authorization header to the lookup and allows it in CORS', async () => {
    const r = res();
    await siteHandler({ method: 'POST', headers: { authorization: 'Bearer abc' }, body: { transactionId: 't-1' } } as any, r);
    expect(runIosSiteLookup).toHaveBeenCalledWith('t-1', expect.anything(), { authorization: 'Bearer abc' });
    expect(r.headers['Access-Control-Allow-Headers']).toContain('Authorization');
  });

  it('missing transactionId → 400 without lookup', async () => {
    const r = res();
    await siteHandler({ method: 'POST', body: {} } as any, r);
    expect(r).toMatchObject({ statusCode: 400, body: { error: 'bad-request' } });
    expect(runIosSiteLookup).not.toHaveBeenCalled();
  });
});
