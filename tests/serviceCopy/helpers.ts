import { vi } from 'vitest';
import { memoryStore } from '../../lib/bookings/rateLimit';
import { makeHandler, type HandlerDeps } from '../../lib/serviceCopy/handler';
import { memoryCopyStore } from '../../lib/serviceCopy/store';
import type { ModelClient, ModelRequest, ModelResult } from '../../lib/serviceCopy/model';
import { CHECK_SYSTEM_PROMPT } from '../../lib/serviceCopy/check';

/** The approval signing key used by the tests (never a real secret). */
export const TEST_SECRET = 'test-signing-secret-0123456789abcdef';
export const U1 = '10000000-0000-0000-0000-000000000001';
export const U2 = '10000000-0000-0000-0000-000000000002';
export const PII = { phone: '(512) 555-0187', phoneDigits: '5125550187', email: 'owner.private@barbermail.test', street: '742 Evergreen Terrace', shop: 'Zanzibar Fades Co', barber: 'Marcus Delgado', review: 'Best haircut of my life says Priya', desc: 'Our signature relaxing hot oil ritual with eucalyptus.' };

const svc = (title: string, extra: Record<string, unknown> = {}) => ({ title, subtitle: '', description: '', icon: 'scissors' as const, imageUrl: '', ...extra });
export function site(extra: Record<string, unknown> = {}, titles: string[] = ['Scalp Massage']) {
  return {
    shopName: PII.shop, area: 'Brooklyn, NY', phone: PII.phone, bookingUrl: '/book', template: 'luxe',
    hero: { heading: PII.shop, tagline: 'x', imageUrl: '' },
    about: { heading: 'About', description: [PII.desc], imageUrl: '' },
    services: [svc('Skin Fade', { description: 'A close fade with a straight razor finish around the ears and the neckline, booked as one visit.', price: '$35' }), ...titles.map((t) => svc(t, { price: '$99', duration: '45 min' }))],
    staff: [{ name: PII.barber, role: 'Owner' }],
    reviews: [{ author: 'Priya', text: PII.review, rating: 5 }],
    gallery: [], hours: [{ day: 'Mon', open: '09:00', close: '17:00' }],
    contact: { address: `${PII.street}, Brooklyn, NY 11201`, email: PII.email },
    pages: { order: [], hidden: [] },
    extraPages: { on: ['faq'], serviceGuides: true, seed: 7 },
    source: 'web-app',
    ...extra,
  } as any;
}

export const GOOD_JSON = {
  heading: 'What to expect from {service}',
  intro: 'Learn what the service involves before you decide. Tell your barber what you would like to change. Bring a photo of the style you have in mind.',
  sections: [
    { h: 'Before you arrive', p: 'Think about how you wear your hair. Wear loose clothes that are easy to move in. Ask about {service} before the visit.' },
    { h: 'During the visit', p: 'Speak up if you would like a change. Check that the plan matches what you asked for.' },
  ],
  faq: [{ q: 'What should you bring to the visit?', a: 'Bring a photo of the look you like. Ask your barber if you have a question.' }],
  metaTitle: 'What to know about {service}',
  metaDescription: 'Learn what a visit for {service} involves and how to prepare.',
};

type Step = string | Error | ((r: ModelRequest) => string | Promise<string>);
export interface ScriptedModel extends ModelClient {
  /** The WRITING calls (the generator prompt). */
  calls: ModelRequest[];
  /** The claim-checker calls (the checker prompt). */
  checks: ModelRequest[];
  script: Step[];
  /** How the checker answers; default clears every sentence. A string/Error/function like `script`. */
  checkScript: Step[];
  usage: { input: number; output: number };
  checkUsage: { input: number; output: number };
}
/** The checker reply that clears every sentence of the request (or flags the ones `flag` selects by text). */
export function verdictsFor(req: ModelRequest, flag: (sentence: string) => boolean = () => false): string {
  const list: string[] = JSON.parse(/<sentences>\n([\s\S]*)\n<\/sentences>/.exec(req.messages[0].content)![1]);
  return JSON.stringify({ verdicts: list.map((t, n) => ({ n, v: flag(t) ? 'flag' : 'clear' })) });
}
export function scriptedModel(script: Step[] = [JSON.stringify(GOOD_JSON)], checkScript: Step[] = [(r) => verdictsFor(r)]): ScriptedModel {
  const m: ScriptedModel = {
    calls: [], checks: [], script, checkScript, usage: { input: 800, output: 900 }, checkUsage: { input: 300, output: 100 },
    async complete(req: ModelRequest): Promise<ModelResult> {
      const isCheck = req.system === CHECK_SYSTEM_PROMPT;
      (isCheck ? m.checks : m.calls).push(JSON.parse(JSON.stringify(req)));
      const list = isCheck ? m.checkScript : m.script;
      const n = isCheck ? m.checks.length : m.calls.length;
      const step = list[Math.min(n - 1, list.length - 1)];
      if (step instanceof Error) throw step;
      const text = typeof step === 'function' ? await step(req) : step;
      return { text, usage: isCheck ? m.checkUsage : m.usage };
    },
  };
  return m;
}

export function response() { const r: any = { code: 0, body: null, headers: {} as Record<string, string>, setHeader: (k: string, v: string) => { r.headers[k] = v; } }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; return r; }

export interface Rig { deps: HandlerDeps; model: ScriptedModel; store: ReturnType<typeof memoryCopyStore>; logs: string[]; drafts: Map<string, any>; clock: { t: number }; limits: ReturnType<typeof memoryStore>; call: (body?: any, opts?: { auth?: string | null; method?: string; raw?: boolean }) => Promise<any> }
export function rig(opts: { secret?: string | null; model?: ScriptedModel; siteData?: any; enabled?: boolean; entitled?: boolean | ((userId: string) => Promise<boolean>); /** SERVICE_COPY_AUTO_PUBLISH. The legacy generation tests run with it ON (text prints without approval); the default of the product is OFF. */ autoPublish?: boolean } = {}): Rig {
  const model = opts.model ?? scriptedModel();
  const store = memoryCopyStore();
  const logs: string[] = [];
  const clock = { t: Date.UTC(2026, 10, 5, 12, 0, 0) };
  const drafts = new Map<string, any>();
  drafts.set(U1, { user_id: U1, draft_id: 'draft-1', revision: 1, site_data: opts.siteData ?? site(), suspended: false });
  const limits = memoryStore();
  const deps: HandlerDeps = {
    enabled: () => opts.enabled ?? true,
    caller: async (a) => (a === 'Bearer u1' ? { id: U1 } : a === 'Bearer u2' ? { id: U2 } : null),
    draft: async (uid) => drafts.get(uid) ?? null,
    entitled: typeof opts.entitled === 'function' ? opts.entitled : async () => (opts.entitled as boolean | undefined) ?? true,
    autoPublish: () => opts.autoPublish ?? true,
    secret: () => (opts.secret === undefined ? TEST_SECRET : opts.secret),
    model: () => model, store, limits, requests: memoryStore(), now: () => clock.t, log: (l) => logs.push(l),
  };
  const handler = makeHandler(deps);
  /** Legacy generation tests mean Mode B: a body with no `mode` is sent as mode 'write'. Pass mode explicitly (or raw) for the product default (classify). */
  const call = async (body: any = { titleKey: 'scalp massage' }, o: { auth?: string | null; method?: string; raw?: boolean } = {}) => {
    if (!o.raw && body && typeof body === 'object' && !Array.isArray(body) && body.mode === undefined) body = { ...body, mode: 'write' };
    const r = response();
    await handler({ method: o.method ?? 'POST', headers: o.auth === null ? {} : { authorization: o.auth ?? 'Bearer u1', origin: 'https://www.primebarber.org' }, body }, r);
    return r;
  };
  return { deps, model, store, logs, drafts, clock, limits, call };
}

/** Any real network request fails the test. */
export function blockNetwork() {
  const spy = vi.fn(async () => { throw new Error('network is blocked in tests'); });
  vi.stubGlobal('fetch', spy);
  return spy;
}
