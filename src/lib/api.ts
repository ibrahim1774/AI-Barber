import type { WebsiteData } from '@/web/types';
import { accessToken } from '@/lib/accessToken';

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
  /** Google listing categories ("Barber shop"); buildSiteFromScrape reads them for the business type. */
  _categories?: string[];
  /** /api/import-business only: what was found, for the "Is this you?" confirm step. */
  match?: ListingMatch;
}

/** The listing /api/import-business found, shown to the barber before anything is built. */
export interface ListingMatch {
  name: string;
  address: string;
  photoUrl: string | null;
  rating: number | null;
  ratingCount: number | null;
  category: string | null;
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
  constructor(public status: number, public code: string, message: string, public body?: any) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Added by the admin-edits server; absent from an older one. */
export interface ServerVersionInfo {
  version?: number;
  editedBy?: 'owner' | 'admin';
  editedAt?: string;
}

const base = () => process.env.EXPO_PUBLIC_API_BASE ?? 'https://www.aibarber.org';

const SCRAPE_TIMEOUT_MS = 100_000;
const DEFAULT_TIMEOUT_MS = 30_000;

const SLOW_MESSAGE =
  'That took too long to answer. Tap the button once more — the second try is usually faster.';
const TIMEOUT_MESSAGE =
  'This is taking longer than it should. Tap the button once more — the second try is usually faster.';
const OFFLINE_MESSAGE = "Couldn't reach Prime Barber — check your connection and try again.";

const GENERIC_MESSAGE = "Couldn't do that right now. Try again in a moment.";

/**
 * A server string may be shown to the user only when it is a short readable
 * sentence ("No shop found at that link"). Codes like `bad-request` or
 * `e2e-internal`, and anything long or technical, never reach the screen.
 */
function isReadable(msg: string): boolean {
  return msg.length > 0 && msg.length <= 140 && /\s/.test(msg) && !/^[\w.-]+:/.test(msg) && !/[{}<>]/.test(msg);
}

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
      status >= 500
        ? opts.slowMessage ?? SLOW_MESSAGE
        : isReadable(serverMsg)
          ? serverMsg
          : serverMsg
            ? GENERIC_MESSAGE
            : opts.failMessage ?? 'Import failed',
      data,
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
  iosPublish(
    body: {
      transactionId: string;
      siteData: WebsiteData;
      /** The site version this phone last saw; the server 409s `site-updated` if an admin edit is newer. */
      baseVersion?: number;
    },
    /** The signed-in user's Supabase access token, sent as `Authorization: Bearer …`. Required: the server links the purchase to the account from it and answers 401 without. */
    accessToken: string,
  ): Promise<{ siteId: string; deployedUrl: string; republished: boolean } & ServerVersionInfo> {
    return post('/api/ios/publish', body, {
      timeoutMs: SCRAPE_TIMEOUT_MS, failMessage: 'Publish failed', slowMessage: 'Publishing is temporarily unavailable — try again shortly.',
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  },

  /**
   * POST /api/ios/site. The ONLY place that calls it: the Bearer is fetched here, so no caller can forget it. Signed out
   * (no usable token): 401 `auth-required` without a request. Errors: 401 auth-required | unauthorized, 404 no-site,
   * 409 purchase-other-account (body.hint = masked email of the owner), 5xx / network.
   */
  async iosSite(
    transactionId: string,
  ): Promise<
    { siteId: string; deployedUrl: string | null; siteData: WebsiteData | null; active: boolean } & ServerVersionInfo
  > {
    const token = await accessToken();
    if (!token) throw new ApiError(401, 'auth-required', 'Sign in to continue.');
    return post('/api/ios/site', { transactionId }, {
      failMessage: 'Could not load your site', headers: { Authorization: `Bearer ${token}` },
    });
  },

  /**
   * POST /api/ios/claim-start, right after a purchase and before any account: the server verifies it with Apple and
   * starts the 30-day claim window. Bookkeeping only (the publish with a Bearer does the real link). Errors: 402
   * subscription-inactive (refunded / revoked), 409 purchase-claimed | purchase-has-site, 429, 503.
   */
  claimStart(transactionId: string): Promise<{ ok: true; state: 'unclaimed' | 'claimed'; claimExpiresAt: string }> {
    return post('/api/ios/claim-start', { transactionId }, { failMessage: 'Could not check your purchase' });
  },

  /**
   * POST /api/ios/signup: the server creates the account already confirmed (no email link); the app then signs in with
   * the same email + password. Errors: 400 bad-request (body.field) | weak-password, 409 email-exists | purchase-in-use, 402 inactive, 429 (signup-limit), 503. The verified transactionId is required.
   */
  signup(body: { name: string; email: string; phone: string; password: string; transactionId: string }): Promise<{ ok: true; email: string }> {
    return post('/api/ios/signup', body, { failMessage: 'Could not create your account' });
  },

  /**
   * Like the web's AuthContext after signUp: copies the user's own metadata
   * phone into auth.users.phone. Callers fire and forget.
   */
  async syncAuthPhone(userId: string): Promise<void> {
    await post('/api/sync-auth-phone', { userId }, { failMessage: 'Could not save your phone number' });
  },

  /**
   * POST /api/ios/take-offline: removes the site bound to this Apple transaction (no account needed). The bearer
   * is required by the server only when the purchase is linked to an account. Errors: 400 bad-request / verify
   * codes, 403 sign-in-required | not-owner, 404 no-site, 409 site-mismatch (expectedSlug is not the bound site), 500 remove-failed, 503 temporarily-unavailable.
   */
  async takeSiteOffline(transactionId: string, accessToken?: string | null, expectedSlug?: string | null): Promise<void> {
    await post('/api/ios/take-offline', expectedSlug ? { transactionId, expectedSlug } : { transactionId }, {
      timeoutMs: SCRAPE_TIMEOUT_MS,
      failMessage: 'Could not take your website offline',
      slowMessage: 'Taking your website offline is temporarily unavailable — try again shortly.',
      ...(accessToken ? { headers: { Authorization: `Bearer ${accessToken}` } } : {}),
    });
  },

  /** Deletes the signed-in user, takes their published sites offline and deletes their content and photos. */
  async deleteAccount(accessToken: string): Promise<void> {
    await post('/api/ios/delete-account', {}, {
      headers: { Authorization: `Bearer ${accessToken}` },
      failMessage: 'Could not delete your account',
    });
  },
};
