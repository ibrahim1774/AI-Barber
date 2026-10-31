// Test helpers for the scraper suites. NOTHING here (or in the suites) reaches the network: every fetch goes
// through stubFetch, a request to an unrouted host throws, and Apify calls are answered from recorded outputs only.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { vi } from 'vitest';

export const FIXTURES = join(__dirname, '..', 'fixtures');
export const fixture = (name: string) => readFileSync(join(FIXTURES, name), 'utf8');
export const DUMMY_APIFY_TOKEN = 'test-token-not-real';

export interface Call { url: string; method: string; body?: string }
type Reply = { status?: number; body: string | object };
type Route = (call: Call) => Reply | undefined;

/** Stub global fetch. `routes` answer by URL; anything unanswered throws, so no test can hit the network. */
export function stubFetch(routes: Route[]) {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', async (input: any, init?: any) => {
    const url = String(typeof input === 'string' ? input : input?.url);
    const call: Call = { url, method: init?.method || 'GET', body: init?.body };
    calls.push(call);
    for (const r of routes) {
      const reply = r(call);
      if (reply) {
        const text = typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body);
        const status = reply.status ?? 200;
        return { ok: status >= 200 && status < 300, status, url, text: async () => text, json: async () => JSON.parse(text) } as any;
      }
    }
    throw new Error(`unrouted fetch in test: ${url}`);
  });
  return {
    calls,
    apify: () => calls.filter((c) => /api\.apify\.com/.test(c.url)),
    places: () => calls.filter((c) => /places\.googleapis\.com/.test(c.url)),
  };
}

export const html = (match: RegExp, body: string): Route => (c) => (match.test(c.url) ? { body } : undefined);
export const json = (match: RegExp, body: object, status = 200): Route => (c) => (match.test(c.url) ? { status, body } : undefined);
/** A RECORDED-shape Apify dataset response (an array of items); never a live call. */
export const apifyItems = (items: object[]): Route => (c) => (/api\.apify\.com/.test(c.url) ? { body: items } : undefined);
