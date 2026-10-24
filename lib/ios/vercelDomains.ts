// Vercel REST calls for custom domains (registrar + project domains). Every call goes through an
// injected fetch so tests never touch Vercel. Endpoints (Vercel REST API, checked 2026-10-22):
//
//   POST   /v1/registrar/domains/availability        { domains: string[] (≤50) } → { results: [{ domain, available }] }
//   POST   /v1/registrar/domains/price               { domains, years? }        → { results: [{ domain, years, purchasePrice, renewalPrice, transferPrice }] }
//   POST   /v1/registrar/domains/{domain}/buy        { autoRenew, years, expectedPrice, contactInformation } → { orderId, _links }
//   GET    /v1/registrar/orders/{orderId}            → { orderId, status: draft|purchasing|completed|failed, domains: [{ domainName, status: pending|completed|failed|refunded|refund-failed }], error?: { code } }
//   PATCH  /v1/registrar/domains/{domain}/auto-renew { autoRenew }              → 204
//   GET    /v5/domains/{domain}                      → { domain: { boughtAt, expiresAt, renew, ... } } (404 when not in this account;
//                                                     boughtAt/expiresAt null when the domain was NOT bought through Vercel)
//   GET    /v5/domains?limit=&until=                 → { domains: [...], pagination: { next } } (admin listing, read-only)
//   POST   /v10/projects/{idOrName}/domains          { name, redirect?, redirectStatusCode? } (409 / 400 when already there)
//   GET    /v9/projects/{idOrName}/domains/{domain}  → { name, verified, redirect, ... }
//   DELETE /v9/projects/{idOrName}/domains/{domain}
//   GET    /v6/domains/{domain}/config               → { misconfigured, ... }
//
// Scope: lib/deploySite.ts deploys without a teamId (the token's own scope). Project-domain calls
// MUST use the same scope as the projects, and the registrar must register into that same scope,
// so every call here uses VERCEL_DOMAINS_TEAM_ID only when it is set (default: none, like deploys).

export type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) =>
  Promise<{ ok: boolean; status: number; json(): Promise<any>; text?(): Promise<string> }>;

export class VercelApiError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message || `Vercel ${status} ${code}`);
    this.name = 'VercelApiError';
  }
}

export interface RegistrantContact {
  firstName: string; lastName: string; email: string; phone: string;
  address1: string; address2?: string; city: string; state: string; zip: string; country: string;
  companyName?: string;
}

const REQUIRED_CONTACT = ['firstName', 'lastName', 'email', 'phone', 'address1', 'city', 'state', 'zip', 'country'] as const;

/**
 * The registrant (WHOIS) contact Vercel requires on every API purchase. Server config only
 * (env VERCEL_REGISTRANT_CONTACT, one JSON object), never in code. Null when missing or invalid.
 */
export function registrantContact(raw: string | undefined = process.env.VERCEL_REGISTRANT_CONTACT): RegistrantContact | null {
  return diagnoseRegistrantContact(raw).contact;
}

/**
 * The contact, or WHY it is unusable: `problem` names the field or the kind of error, never a
 * value (the contact is personal data and must not reach a log).
 */
export function diagnoseRegistrantContact(raw: string | undefined = process.env.VERCEL_REGISTRANT_CONTACT): { contact: RegistrantContact | null; problem: string | null } {
  const no = (problem: string) => ({ contact: null, problem });
  if (!raw || !raw.trim()) return no('missing');
  let c: any;
  try {
    c = JSON.parse(raw);
  } catch {
    return no('not valid JSON');
  }
  if (!c || typeof c !== 'object' || Array.isArray(c)) return no('not a JSON object');
  for (const k of REQUIRED_CONTACT) if (typeof c[k] !== 'string' || !c[k].trim()) return no(`field ${k} missing or empty`);
  // Vercel's own E.164 rule (8–15 digits), so a bad phone is caught at config time, not at the first buy.
  if (!/^(?=(?:\D*\d){8,15}$)\+[1-9]\d{0,2}\.?\d+$/.test(c.phone)) return no('field phone is not E.164 (+15555550123, 8-15 digits, no spaces)');
  if (!/^[A-Z]{2}$/.test(c.country)) return no('field country is not an upper-case ISO-2 code');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(c.email)) return no('field email is not an email address');
  const out: RegistrantContact = {} as RegistrantContact;
  for (const k of [...REQUIRED_CONTACT, 'address2', 'companyName'] as const) {
    if (typeof c[k] === 'string' && c[k].trim()) (out as any)[k] = c[k].trim();
  }
  return { contact: out, problem: null };
}

export interface DomainPrice { purchasePrice: unknown; renewalPrice: unknown }

export type BuyResult =
  | { ok: true; orderId: string }
  /**
   * `definite`: Vercel answered with a 4xx, so no order was placed. Otherwise (5xx, 429, network,
   * timeout) it is unknown whether an order exists.
   */
  | { ok: false; code: string; status: number; definite: boolean };

export interface OrderState {
  status: 'draft' | 'purchasing' | 'completed' | 'failed' | string;
  /** This domain's line in the order. */
  domainStatus: 'pending' | 'completed' | 'failed' | 'refunded' | 'refund-failed' | string | null;
  errorCode: string | null;
}

/** A registration Vercel holds for us: bought through Vercel and not expired. */
export interface OwnedDomain {
  boughtAt: number;
  expiresAt: number;
  renew: boolean;
}

/** One entry of the account's domain list (admin, read-only). */
export interface AccountDomain {
  name: string;
  boughtAt: number | null;
  expiresAt: number | null;
  renew: boolean;
  serviceType: string | null;
}

export interface VercelDomains {
  availability(domains: string[]): Promise<Map<string, boolean>>;
  prices(domains: string[]): Promise<Map<string, DomainPrice>>;
  buy(domain: string, opts: { expectedPrice: number; autoRenew: boolean; contact: RegistrantContact }): Promise<BuyResult>;
  order(orderId: string, domain: string): Promise<OrderState>;
  /**
   * The registration in this account (GET /v5/domains/{d}), or null when it is not ours: not in
   * the account, NOT bought through Vercel (boughtAt null), or expired. Throws on errors, so an
   * outage is never read as "gone".
   */
  owned(domain: string): Promise<OwnedDomain | null>;
  /**
   * The registration as Vercel holds it, EXPIRED ones included (a renewal may still land in the
   * registry's grace window); null only when it is not in the account or not bought via Vercel.
   */
  lookup(domain: string): Promise<OwnedDomain | null>;
  /** Every domain in the account (admin listing; read-only). */
  listDomains(): Promise<AccountDomain[]>;
  setAutoRenew(domain: string, on: boolean): Promise<void>;
  /** Add `name` to the project; 'exists' when it is already on THIS project. */
  addProjectDomain(project: string, name: string, redirectTo?: string): Promise<'added' | 'exists'>;
  removeProjectDomain(project: string, name: string): Promise<'removed' | 'absent'>;
  projectDomain(project: string, name: string): Promise<{ verified: boolean; redirect: string | null } | null>;
  domainConfig(domain: string): Promise<{ misconfigured: boolean } | null>;
}

const API = 'https://api.vercel.com';
const enc = encodeURIComponent;

export function makeVercelDomains(opts: { token: string; teamId?: string; fetch: Fetch; timeoutMs?: number; now?: () => number }): VercelDomains {
  const timeoutMs = opts.timeoutMs ?? 20_000;
  const now = opts.now ?? Date.now;
  const url = (path: string) => `${API}${path}${opts.teamId ? `${path.includes('?') ? '&' : '?'}teamId=${enc(opts.teamId)}` : ''}`;

  async function call(method: string, path: string, body?: unknown) {
    const res = await opts.fetch(url(path), {
      method,
      headers: { Authorization: `Bearer ${opts.token}`, 'Content-Type': 'application/json' },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
    });
    let data: any = null;
    if (res.status !== 204) data = await res.json().catch(() => null);
    return { status: res.status, ok: res.ok, data };
  }

  const errCode = (data: any) => String(data?.code || data?.error?.code || 'unknown');
  async function must(method: string, path: string, body?: unknown) {
    const r = await call(method, path, body);
    if (!r.ok) throw new VercelApiError(r.status, errCode(r.data));
    return r.data;
  }

  const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

  return {
    async availability(domains) {
      const out = new Map<string, boolean>();
      for (const part of chunks(domains, 50)) {
        const data = await must('POST', '/v1/registrar/domains/availability', { domains: part });
        for (const r of data?.results || []) if (typeof r?.domain === 'string') out.set(r.domain, r.available === true);
      }
      return out;
    },

    async prices(domains) {
      const out = new Map<string, DomainPrice>();
      for (const part of chunks(domains, 50)) {
        const data = await must('POST', '/v1/registrar/domains/price', { domains: part, years: 1 });
        for (const r of data?.results || []) {
          if (typeof r?.domain === 'string') out.set(r.domain, { purchasePrice: r.purchasePrice, renewalPrice: r.renewalPrice });
        }
      }
      return out;
    },

    async buy(domain, b) {
      let r;
      try {
        r = await call('POST', `/v1/registrar/domains/${enc(domain)}/buy`, {
          autoRenew: b.autoRenew,
          years: 1,
          expectedPrice: b.expectedPrice,
          contactInformation: b.contact,
        });
      } catch (e: any) {
        return { ok: false, code: e?.name === 'TimeoutError' ? 'timeout' : 'network', status: 0, definite: false };
      }
      if (r.ok && typeof r.data?.orderId === 'string') return { ok: true, orderId: r.data.orderId };
      const definite = r.status >= 400 && r.status < 500 && r.status !== 429 && r.status !== 408;
      return { ok: false, code: r.ok ? 'no-order-id' : errCode(r.data), status: r.status, definite };
    },

    async order(orderId, domain) {
      const data = await must('GET', `/v1/registrar/orders/${enc(orderId)}`);
      const line = (data?.domains || []).find((d: any) => d?.domainName === domain) || (data?.domains || [])[0] || null;
      return { status: String(data?.status || ''), domainStatus: line ? String(line.status || '') : null, errorCode: data?.error?.code ? String(data.error.code) : null };
    },

    async owned(domain) {
      const d = await this.lookup(domain);
      return d && d.expiresAt > now() ? d : null;
    },

    async lookup(domain) {
      const r = await call('GET', `/v5/domains/${enc(domain)}`);
      if (r.status === 404) return null;
      if (!r.ok) throw new VercelApiError(r.status, errCode(r.data));
      const d = r.data?.domain;
      if (!d || typeof d.boughtAt !== 'number' || typeof d.expiresAt !== 'number') return null;
      return { boughtAt: d.boughtAt, expiresAt: d.expiresAt, renew: d.renew === true };
    },

    async listDomains() {
      const out: AccountDomain[] = [];
      let until: number | null = null;
      for (let page = 0; page < 50; page++) {
        const data = await must('GET', `/v5/domains?limit=100${until != null ? `&until=${until}` : ''}`);
        for (const d of data?.domains || []) {
          if (typeof d?.name !== 'string') continue;
          out.push({
            name: d.name,
            boughtAt: typeof d.boughtAt === 'number' ? d.boughtAt : null,
            expiresAt: typeof d.expiresAt === 'number' ? d.expiresAt : null,
            renew: d.renew === true,
            serviceType: typeof d.serviceType === 'string' ? d.serviceType : null,
          });
        }
        const next = data?.pagination?.next;
        if (typeof next !== 'number' || !(data?.domains || []).length) break;
        until = next;
      }
      return out;
    },

    async setAutoRenew(domain, on) {
      await must('PATCH', `/v1/registrar/domains/${enc(domain)}/auto-renew`, { autoRenew: on });
    },

    async addProjectDomain(project, name, redirectTo) {
      const body: Record<string, unknown> = { name };
      if (redirectTo) {
        body.redirect = redirectTo;
        body.redirectStatusCode = 308;
      }
      const r = await call('POST', `/v10/projects/${enc(project)}/domains`, body);
      if (r.ok) return 'added';
      // Already there? Only "on THIS project" counts; another project holding it stays an error.
      if (r.status === 400 || r.status === 409) {
        const mine = await this.projectDomain(project, name);
        if (mine) return 'exists';
      }
      throw new VercelApiError(r.status, errCode(r.data));
    },

    async removeProjectDomain(project, name) {
      const r = await call('DELETE', `/v9/projects/${enc(project)}/domains/${enc(name)}`);
      if (r.ok) return 'removed';
      if (r.status === 404) return 'absent';
      throw new VercelApiError(r.status, errCode(r.data));
    },

    async projectDomain(project, name) {
      const r = await call('GET', `/v9/projects/${enc(project)}/domains/${enc(name)}`);
      if (r.status === 404) return null;
      if (!r.ok) throw new VercelApiError(r.status, errCode(r.data));
      return { verified: r.data?.verified === true, redirect: typeof r.data?.redirect === 'string' ? r.data.redirect : null };
    },

    async domainConfig(domain) {
      const r = await call('GET', `/v6/domains/${enc(domain)}/config`);
      if (r.status === 404) return null;
      if (!r.ok) throw new VercelApiError(r.status, errCode(r.data));
      return { misconfigured: r.data?.misconfigured === true };
    },
  };
}

/** The live client: VERCEL_TOKEN (needs registrar scope on the team), optional VERCEL_DOMAINS_TEAM_ID. */
export function liveVercelDomains(): VercelDomains | null {
  const token = process.env.VERCEL_TOKEN;
  if (!token) return null;
  return makeVercelDomains({ token, teamId: process.env.VERCEL_DOMAINS_TEAM_ID || undefined, fetch: fetch as unknown as Fetch });
}
