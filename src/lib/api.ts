import type { WebsiteData } from '@/web/types';

// Response shape of /api/import-scrape and /api/import-business (copied from
// AI-Barber components/GbpImportPage.tsx; the two routes deliberately mirror
// each other so there is a single mapping layer in importer.ts).
export interface ScrapePayload {
  shopName?: string;
  area?: string;
  address?: string;
  phone?: string;
  description?: string;
  bookingUrl?: string;
  photos?: string[];
  services?: any[];
  reviews?: any[];
  hours?: any[];
  staff?: any[];
  aggregateRating?: any;
  _platform?: string;
}

// One row of /api/find-business `candidates` (search-only; import it afterwards
// via its placeId).
export interface Candidate {
  title: string;
  address: string;
  category: string;
  placeId: string;
  rating: number | null;
  reviews: number | null;
}

/**
 * `code` is the server's `error` string (fallback `http-<status>`). Network
 * failures and timeouts use code `network` with status 0, so callers can tell
 * "retry later" (network / 5xx) from "rejected" (4xx).
 */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

const base = () => process.env.EXPO_PUBLIC_API_BASE ?? 'https://www.aibarber.org';

const SCRAPE_TIMEOUT_MS = 100_000;
const DEFAULT_TIMEOUT_MS = 30_000;

const SLOW_MESSAGE =
  'That took too long to answer. Tap Build my website once more — the second try is usually faster.';
const TIMEOUT_MESSAGE =
  'This is taking longer than it should. Tap Build my website once more — the second try is usually faster.';
const OFFLINE_MESSAGE = "Couldn't reach AI Barber — check your connection and try again.";

interface RequestOpts {
  headers?: Record<string, string>;
  timeoutMs?: number;
  failMessage?: string; // used when the server gave no message (4xx / bad body)
  slowMessage?: string; // used for 5xx without a server message
}

async function post<T>(path: string, body: unknown, opts: RequestOpts = {}): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let status = 0;
  let raw = '';
  let ok = false;
  try {
    const resp = await fetch(`${base()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...opts.headers },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    status = resp.status;
    raw = await resp.text();
    ok = resp.ok;
  } catch (e: any) {
    throw new ApiError(0, 'network', e?.name === 'AbortError' ? TIMEOUT_MESSAGE : OFFLINE_MESSAGE);
  } finally {
    clearTimeout(timer);
  }

  // A gateway timeout comes back as an HTML page, so parse defensively.
  let data: any = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }

  if (!ok) {
    const serverMsg = typeof data?.error === 'string' && data.error ? data.error : '';
    throw new ApiError(
      status,
      serverMsg || `http-${status}`,
      serverMsg ||
        (status >= 500 ? opts.slowMessage ?? SLOW_MESSAGE : opts.failMessage ?? 'Import failed'),
    );
  }
  if (data === null) {
    throw new ApiError(status, 'bad-response', opts.failMessage ?? 'Import failed — please try again.');
  }
  return data as T;
}

const SEARCH_FAILED = 'Search failed — try again, or fill in your details manually below.';

export const api = {
  importScrape(url: string): Promise<ScrapePayload> {
    return post<ScrapePayload>('/api/import-scrape', { url }, { timeoutMs: SCRAPE_TIMEOUT_MS });
  },

  placesAutocomplete(input: string): Promise<{ suggestions: unknown[]; error?: string }> {
    return post('/api/places-autocomplete', { input }, { failMessage: SEARCH_FAILED, slowMessage: SEARCH_FAILED });
  },

  findBusiness(query: string, near?: string): Promise<{ candidates: Candidate[]; searchedNear: string | null }> {
    return post(
      '/api/find-business',
      { query, near: near ?? null },
      { failMessage: SEARCH_FAILED, slowMessage: SEARCH_FAILED },
    );
  },

  importBusiness(url: string): Promise<ScrapePayload> {
    return post<ScrapePayload>('/api/import-business', { url }, { timeoutMs: SCRAPE_TIMEOUT_MS });
  },

  async getUploadUrls(
    folder: string,
    filenames: string[],
  ): Promise<{ filename: string; signedUrl: string; publicUrl: string }[]> {
    const out = await post<{ urls: { filename: string; signedUrl: string; publicUrl: string }[] }>(
      '/api/get-upload-urls',
      { siteId: folder, filenames },
    );
    return out.urls;
  },

  /**
   * POST /api/ios/publish. Does NOT mutate `siteData`. Backend contract: the
   * server rejects (400 bad-request) any string value inside siteData that
   * STARTS WITH `data:` (inline data URIs), and requires `hero` and `about`
   * objects plus `gallery` and `services` arrays. Callers must upload images
   * first (getUploadUrls) and replace data URIs with public URLs.
   * Errors: 400 bad-request / verify codes, 402 subscription-inactive,
   * 404 verify codes, 502 publish-failed, 503 temporarily-unavailable |
   * apple-unavailable | slug-bind-failed.
   */
  iosPublish(body: {
    transactionId: string;
    siteData: WebsiteData;
    userId?: string | null;
  }): Promise<{ siteId: string; deployedUrl: string; republished: boolean }> {
    return post('/api/ios/publish', body, { timeoutMs: SCRAPE_TIMEOUT_MS, failMessage: 'Publish failed', slowMessage: 'Publishing is temporarily unavailable — try again shortly.' });
  },

  iosSite(
    transactionId: string,
  ): Promise<{ siteId: string; deployedUrl: string | null; siteData: WebsiteData | null; active: boolean }> {
    return post('/api/ios/site', { transactionId }, { failMessage: 'Could not load your site' });
  },

  async deleteAccount(accessToken: string): Promise<void> {
    await post('/api/ios/delete-account', {}, {
      headers: { Authorization: `Bearer ${accessToken}` },
      failMessage: 'Could not delete your account',
    });
  },
};
