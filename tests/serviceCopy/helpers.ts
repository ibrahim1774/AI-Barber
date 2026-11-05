import { vi } from 'vitest';
import { memoryStore } from '../../lib/bookings/rateLimit';
import { makeHandler, type HandlerDeps } from '../../lib/serviceCopy/handler';
import { memoryCopyStore } from '../../lib/serviceCopy/store';
import type { ModelClient, ModelRequest, ModelResult } from '../../lib/serviceCopy/model';

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
  intro: 'A calm visit for the head and neck can be a slow part of the day. Tell your barber if you prefer lighter or firmer pressure. Plan a little extra time so the visit does not feel rushed.',
  sections: [
    { h: 'Before you book', p: 'Think about how much time you have. Wear a top that is easy to move around in. Ask about {service} when you book.' },
    { h: 'During the visit', p: 'Speak up if anything feels uncomfortable. Your barber can adjust at any point.' },
  ],
  faq: [{ q: 'What should you bring to the visit?', a: 'Bring nothing special. Ask your barber if you have a question.' }],
  metaTitle: '{service}: what to know',
  metaDescription: 'Plain notes on what a visit for {service} involves and how to prepare.',
};

export interface ScriptedModel extends ModelClient { calls: ModelRequest[]; script: (string | Error | ((r: ModelRequest) => string | Promise<string>))[]; usage: { input: number; output: number } }
export function scriptedModel(script: ScriptedModel['script'] = [JSON.stringify(GOOD_JSON)]): ScriptedModel {
  const m: ScriptedModel = {
    calls: [], script, usage: { input: 800, output: 900 },
    async complete(req: ModelRequest): Promise<ModelResult> {
      m.calls.push(JSON.parse(JSON.stringify(req)));
      const step = m.script[Math.min(m.calls.length - 1, m.script.length - 1)];
      if (step instanceof Error) throw step;
      const text = typeof step === 'function' ? await step(req) : step;
      return { text, usage: m.usage };
    },
  };
  return m;
}

export function response() { const r: any = { code: 0, body: null, headers: {} as Record<string, string>, setHeader: (k: string, v: string) => { r.headers[k] = v; } }; r.status = (c: number) => { r.code = c; return r; }; r.json = (b: any) => { r.body = b; return r; }; return r; }

export interface Rig { deps: HandlerDeps; model: ScriptedModel; store: ReturnType<typeof memoryCopyStore>; logs: string[]; drafts: Map<string, any>; clock: { t: number }; limits: ReturnType<typeof memoryStore>; call: (body?: any, opts?: { auth?: string | null; method?: string }) => Promise<any> }
export function rig(opts: { model?: ScriptedModel; siteData?: any; enabled?: boolean } = {}): Rig {
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
    model: () => model, store, limits, requests: memoryStore(), now: () => clock.t, log: (l) => logs.push(l),
  };
  const handler = makeHandler(deps);
  const call = async (body: any = { titleKey: 'scalp massage' }, o: { auth?: string | null; method?: string } = {}) => {
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
