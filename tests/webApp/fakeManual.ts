// Shared fakes for the manual web-domain fulfilment tests (lib/webApp/domainManual.ts).
import { vi } from 'vitest';
import type { ManualDeps } from '../../lib/webApp/domainManual.js';
import type { Mail } from '../../lib/webApp/emails.js';

export interface SentMail { to: string; mail: Mail; key: string }

export function fakeManual(over: Partial<ManualDeps> = {}) {
  const sent: SentMail[] = [];
  const state = { failSends: false, failFor: new Set<string>(), seenKeys: new Set<string>() };
  const deps: ManualDeps = {
    // Mimics Resend's Idempotency-Key: a repeated key is accepted but delivers nothing new.
    sendMail: vi.fn(async (to: string, mail: Mail, key: string) => {
      if (state.failSends || state.failFor.has(to)) throw new Error('resend 500');
      if (state.seenKeys.has(key)) return;
      state.seenKeys.add(key);
      sent.push({ to, mail, key });
    }),
    ordersEmail: 'orders@example.test',
    linkSecret: 'test-link-secret-0123456789abcdef0123456789',
    linkBase: 'https://api.example.test',
    appOrigin: 'https://app.example.test',
    customerOf: vi.fn(async () => ({ email: 'shop@customer.test', shopName: 'Fresh Cuts' })),
    liveUrlOf: vi.fn(async (slug: string) => `https://${slug}.vercel.app`),
    teamSlug: 'team-x',
    verifyStub: false,
    getSubscription: vi.fn(async (id: string) => ({ id, customer: 'cus_cust0001', livemode: true })),
    fetchCanonical: vi.fn(async (d: string) => `https://${d}/`),
    isWebAppSite: vi.fn(async (_slug: string) => false),
    ...over,
  };
  return { deps, sent, state, toOrders: () => sent.filter((s) => s.to === deps.ordersEmail), toCustomer: () => sent.filter((s) => s.to !== deps.ordersEmail) };
}
