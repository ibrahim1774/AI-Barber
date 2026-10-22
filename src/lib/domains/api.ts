import Storage from 'expo-sqlite/kv-store';
import { ApiError } from '@/lib/api';
import type { DomainClaimRecord, DomainStatus, SearchResult } from '@/lib/domains/model';

const base = () => process.env.EXPO_PUBLIC_API_BASE ?? 'https://www.aibarber.org';
const TIMEOUT_MS = 30_000;
/** A claim can run the registrar and a republish: the server answers within its 300 s budget. */
const CLAIM_TIMEOUT_MS = 120_000;
const OFFLINE = "Couldn't reach AI Barber — check your connection and try again.";

type Answer = { status: number; body: any };

async function request(method: 'GET' | 'POST', path: string, body: unknown, opts: { token?: string | null; timeoutMs?: number } = {}): Promise<Answer> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? TIMEOUT_MS);
  try {
    const resp = await fetch(`${base()}${path}`, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    const raw = await resp.text();
    let json: any = null;
    try {
      json = raw ? JSON.parse(raw) : null;
    } catch {
      json = null;
    }
    return { status: resp.status, body: json };
  } catch {
    throw new ApiError(0, 'network', OFFLINE);
  } finally {
    clearTimeout(timer);
  }
}

const fail = (a: Answer): never => {
  const code = typeof a.body?.error === 'string' ? a.body.error : `http-${a.status}`;
  throw new ApiError(a.status, code, code === 'rate-limited' ? 'Too many searches. Wait a minute and try again.' : "Couldn't do that right now. Try again in a moment.", a.body);
};

/** POST /api/ios/domain/search → only well-formed rows. */
export async function searchDomains(q: string, transactionId?: string | null): Promise<SearchResult[]> {
  const a = await request('POST', '/api/ios/domain/search', { q, ...(transactionId ? { transactionId } : {}) });
  if (a.status !== 200 || !Array.isArray(a.body?.results)) return fail(a);
  return (a.body.results as any[])
    .filter((r) => r && typeof r.domain === 'string' && /^[a-z0-9-]+\.com$/.test(r.domain))
    .map((r) => ({ domain: r.domain, available: r.available === true, eligible: r.eligible === true }));
}

/** POST /api/ios/domain/claim: the raw answer (200 / 202 / 409 / …) for claimOutcome(). */
export function claimDomain(
  body: { transactionId: string; siteTransactionId: string; domain: string },
  token?: string | null,
): Promise<Answer> {
  return request('POST', '/api/ios/domain/claim', body, { token, timeoutMs: CLAIM_TIMEOUT_MS });
}

/** GET /api/ios/domain/status. Throws on anything but a status body. */
export async function domainStatus(transactionId: string): Promise<DomainStatus> {
  const a = await request('GET', `/api/ios/domain/status?transactionId=${encodeURIComponent(transactionId)}`, undefined);
  if (a.status !== 200 || typeof a.body?.state !== 'string') return fail(a);
  return a.body as DomainStatus;
}

const KEY = 'domainClaim.v1';

export async function loadDomainClaim(): Promise<DomainClaimRecord | null> {
  try {
    const raw = await Storage.getItem(KEY);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v.transactionId === 'string' && typeof v.domain === 'string' ? v : null;
  } catch {
    return null;
  }
}

export async function saveDomainClaim(r: DomainClaimRecord | null): Promise<void> {
  if (r) await Storage.setItem(KEY, JSON.stringify(r));
  else await Storage.removeItem(KEY);
}
