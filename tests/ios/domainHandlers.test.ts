import { describe, it, expect, vi, beforeEach } from 'vitest';

const { allow, runDomainSearch, runDomainClaim, runDomainStatus } = vi.hoisted(() => ({
  allow: vi.fn(async () => true),
  runDomainSearch: vi.fn(async () => ({ status: 200, body: { results: [] } })),
  runDomainClaim: vi.fn(async () => ({ status: 202, body: { state: 'registering' } })),
  runDomainStatus: vi.fn(async () => ({ status: 200, body: { state: 'none', domain: null } })),
}));
vi.mock('../../lib/bookings/rateLimit.js', async (orig) => ({ ...(await orig<object>()), publicLimiter: { allow } }));
vi.mock('../../lib/ios/domainFlow.js', () => ({ runDomainSearch, runDomainClaim, runDomainStatus }));
vi.mock('../../lib/ios/domainLive.js', () => ({ liveDomainDeps: () => ({ marker: 'live' }) }));
vi.mock('../../lib/ios/vercelDomains.js', () => ({ liveVercelDomains: () => null }));

import search from '../../api/ios/domain/search.js';
import claim from '../../api/ios/domain/claim.js';
import status from '../../api/ios/domain/status.js';

const mkRes = () => {
  const res: any = { headers: {} as Record<string, string> };
  res.setHeader = vi.fn((k: string, v: string) => { res.headers[k] = v; });
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  res.end = vi.fn(() => res);
  return res;
};
const req = (method: string, over: any = {}) => ({ method, headers: { 'x-real-ip': '1.2.3.4' }, query: {}, body: {}, ...over });

describe('api/ios/domain/*', () => {
  beforeEach(() => { allow.mockClear(); allow.mockResolvedValue(true); });

  it('search: POST only; passes the client IP for the per-IP limit', async () => {
    let res = mkRes();
    await search(req('GET') as any, res);
    expect(res.status).toHaveBeenCalledWith(405);
    res = mkRes();
    await search(req('POST', { body: { q: 'fresh' } }) as any, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(runDomainSearch).toHaveBeenCalledWith({ q: 'fresh' }, expect.anything(), '1.2.3.4');
    expect(allow).not.toHaveBeenCalledWith('1.2.3.4', 'write'); // never the bookings' shared write bucket
  });

  it('claim passes the body, the Authorization header and the IP through', async () => {
    const res = mkRes();
    await claim(req('POST', { body: { transactionId: '1' }, headers: { authorization: 'Bearer x', 'x-real-ip': '1.2.3.4' } }) as any, res);
    expect(runDomainClaim).toHaveBeenCalledWith({ transactionId: '1' }, 'Bearer x', { marker: 'live' }, '1.2.3.4');
    expect(res.status).toHaveBeenCalledWith(202);
  });

  it('status: GET ?transactionId= and POST body, read limit', async () => {
    let res = mkRes();
    await status(req('GET', { query: { transactionId: '77' } }) as any, res);
    expect(runDomainStatus).toHaveBeenLastCalledWith('77', { marker: 'live' });
    res = mkRes();
    await status(req('POST', { body: { transactionId: '78' } }) as any, res);
    expect(runDomainStatus).toHaveBeenLastCalledWith('78', { marker: 'live' });
    expect(allow).toHaveBeenCalledWith('1.2.3.4', 'read');
  });
});
