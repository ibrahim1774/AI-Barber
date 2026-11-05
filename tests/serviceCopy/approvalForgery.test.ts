// Review 6c B2: the approval of model text is SERVER-STAMPED. A client can send any approval, family or proposal-state value on any
// save path; none of them makes text print. Model text prints only when the server's signature verifies for the exact text, service
// key, niche and (where known) owner. Everything here is pure or mocked: no model, no network.
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { entryDigest, signingSecret, stampApproval, userScope, verifyApproval } from '../../lib/serviceCopy/approval';
import { svcCopySanitize } from '../../lib/serviceCopy/prune';
import { renderPendingBundle } from '../../lib/publishSite';
import { renderSiteBundle } from '../../lib/render/site';
import { validateWebSnapshot, runWebPublish, type WebPublishDeps } from '../../lib/webApp/publishFlow';
import type { PendingSite } from '../../lib/publishSite';
import { GOOD_JSON, TEST_SECRET, U1, U2, site } from './helpers';

const OTHER_SECRET = 'a-different-signing-secret-ffffffff';
const NICHE = 'Barbershop';
const BASE = { siteBaseUrl: 'https://fresh.example.com' };
const MARK = 'Learn what the service involves before you decide';
const text = { v: 1 as const, aiGenerated: true, ...GOOD_JSON, intro: GOOD_JSON.intro, at: '2026-11-05T12:00:00.000Z' };
const sign = (mode: 'owner' | 'auto' = 'owner', key = 'scalp massage', user = U1, niche = NICHE, secret = TEST_SECRET) => stampApproval(secret, { userId: user }, key, niche, text as never, mode) as any;
const withCopy = (copy: Record<string, unknown>, extra: Record<string, unknown> = {}) => site({ extraPages: { on: ['faq'], serviceGuides: true, seed: 7, svcCopy: copy }, ...extra });
const everything = (r: { sitemap: string | null; pages: { html: string }[] }) => [r.sitemap ?? '', ...r.pages.map((p) => p.html)].join('\n');
const deploy = (d: any) => renderPendingBundle({ siteData: d, imageUrlMap: {} }, BASE);
const flag = async <T>(on: boolean, fn: () => T | Promise<T>): Promise<T> => {
  const prev = process.env.SERVICE_COPY_AUTO_PUBLISH;
  if (on) process.env.SERVICE_COPY_AUTO_PUBLISH = '1'; else delete process.env.SERVICE_COPY_AUTO_PUBLISH;
  try { return await fn(); } finally { if (prev === undefined) delete process.env.SERVICE_COPY_AUTO_PUBLISH; else process.env.SERVICE_COPY_AUTO_PUBLISH = prev; }
};

describe('the signature itself', () => {
  it('a stamped entry verifies for exactly its service key, niche and owner', () => {
    const e = sign();
    expect(e.approval).toBe('owner'); expect(e.approvalSig).toMatch(/^[0-9a-f]{64}$/); expect(e.approvalScope).toBe(userScope(TEST_SECRET, U1));
    expect(verifyApproval(TEST_SECRET, e, 'scalp massage', NICHE)).toBe(true);
    expect(verifyApproval(TEST_SECRET, e, 'scalp massage', NICHE, U1)).toBe(true);
    expect(verifyApproval(TEST_SECRET, e, 'scalp massage', NICHE, U2)).toBe(false);       // another owner
    expect(verifyApproval(TEST_SECRET, e, 'eyebrow styling', NICHE)).toBe(false);         // another service
    expect(verifyApproval(TEST_SECRET, e, 'scalp massage', 'Nail Salon')).toBe(false);    // another niche
    expect(verifyApproval(OTHER_SECRET, e, 'scalp massage', NICHE)).toBe(false);          // another key
    expect(verifyApproval(null, e, 'scalp massage', NICHE)).toBe(false);                  // no key: fail closed
    expect(verifyApproval('', e, 'scalp massage', NICHE)).toBe(false);
  });
  it('any change to the text, the approval, the signature or the scope breaks it', () => {
    const e = sign();
    const bad: any[] = [
      { ...e, intro: e.intro.replace('Learn', 'Lear') }, { ...e, heading: 'Something else' }, { ...e, at: '2026-11-06T12:00:00.000Z' },
      { ...e, sections: [...e.sections].reverse() }, { ...e, faq: [] }, { ...e, metaTitle: 'x' },
      { ...e, approval: 'auto' }, { ...e, approvalSig: e.approvalSig.replace(/^./, e.approvalSig[0] === 'a' ? 'b' : 'a') }, { ...e, approvalScope: userScope(TEST_SECRET, U2) },
      { ...e, approvalSig: undefined }, { ...e, approvalScope: undefined }, { ...e, aiGenerated: false }, { ...e, approvalSig: 'x'.repeat(64) },
    ];
    for (const b of bad) expect(verifyApproval(TEST_SECRET, b, 'scalp massage', NICHE), JSON.stringify(Object.keys(b).length)).toBe(false);
  });
  it('the signature binds the label: an owner stamp cannot be relabelled auto and an auto stamp cannot be relabelled owner', () => {
    expect(verifyApproval(TEST_SECRET, { ...sign('owner'), approval: 'auto' }, 'scalp massage', NICHE)).toBe(false);
    expect(verifyApproval(TEST_SECRET, { ...sign('auto'), approval: 'owner' }, 'scalp massage', NICHE)).toBe(false);
  });
  it('no secret, a short secret or an unusable entry: nothing is stamped, nothing verifies', () => {
    expect(signingSecret({})).toBeNull(); expect(signingSecret({ SERVICE_COPY_SIGNING_SECRET: 'short' })).toBeNull(); expect(signingSecret({ SERVICE_COPY_SIGNING_SECRET: TEST_SECRET })).toBe(TEST_SECRET);
    expect(stampApproval(null, { userId: U1 }, 'k', NICHE, text as never, 'owner')).toBeNull();
    expect(stampApproval(TEST_SECRET, { userId: U1 }, 'k', NICHE, { v: 2 } as never, 'owner')).toBeNull();
    expect(entryDigest({ nope: 1 })).toBeNull();
    for (const v of [null, undefined, 5, 'x', [], {}]) expect(verifyApproval(TEST_SECRET, v, 'k', NICHE)).toBe(false);
  });
  it('the digest ignores key order and the approval fields only', () => {
    const e = sign();
    const shuffled = Object.fromEntries(Object.entries(e).reverse());
    expect(entryDigest(shuffled)).toBe(entryDigest(text));
    expect(verifyApproval(TEST_SECRET, shuffled, 'scalp massage', NICHE)).toBe(true);
  });
});

// Forgeries any server step can refuse (no owner needed). A signature copied from ANOTHER ACCOUNT is refused wherever the signed-in
// owner is known (draft save, publish) and tested separately: a pending-site render has no owner to compare with.
const FORGERIES: [string, () => any][] = [
  ['an owner stamp written by the client (no signature)', () => ({ ...text, approval: 'owner' })],
  ['an auto stamp written by the client', () => ({ ...text, approval: 'auto' })],
  ['a made-up signature and scope', () => ({ ...text, approval: 'owner', approvalSig: 'a'.repeat(64), approvalScope: 'b'.repeat(32) })],
  ['a signature taken from another service, moved under this key', () => sign('owner', 'eyebrow styling')],
  ['a signature made with another secret', () => sign('owner', 'scalp massage', U1, NICHE, OTHER_SECRET)],
  ['a signed entry whose text was edited afterwards', () => ({ ...sign(), intro: sign().intro.replace('Learn', 'Study') })],
  ['a signed entry for another niche', () => sign('owner', 'scalp massage', U1, 'Nail Salon')],
  ['an owner stamp relabelled auto', () => ({ ...sign('owner'), approval: 'auto' })],
  ['a proposal state field the server never set', () => ({ ...text, approval: 'owner', state: 'approved' })],
  ['a family-approval field on the entry', () => ({ ...sign(), familyApproved: true })],
];

describe('forging approval on every path: nothing prints', () => {
  for (const [label, make] of FORGERIES) {
    it(`deploy render (renderPending: admin redeploy, lapse restore, sweeper, webhook, save-pending-site, iOS re-save, preview of a pending copy): ${label}`, async () => {
      for (const on of [false, true]) await flag(on, () => {
        const b = deploy(withCopy({ 'scalp massage': make() }));
        expect(everything(b), `flag ${on}`).not.toContain(MARK);
        expect(b.sitemap ?? '').not.toContain('/services/scalp-massage/');
      });
    });
    it(`publish snapshot (validateWebSnapshot): ${label}`, async () => {
      for (const on of [false, true]) await flag(on, () => {
        const r = validateWebSnapshot(withCopy({ 'scalp massage': make() }), () => []);
        expect((r.sd.extraPages as any).svcCopy, `flag ${on}`).toBeUndefined();
        expect((r.pendingData.extraPages as any).svcCopy).toBeUndefined();
      });
    });
    it(`server cleaning step used by the draft save, a 3-way merge result and an old-client re-save: ${label}`, () => {
      const out = svcCopySanitize(withCopy({ 'scalp massage': make() }), { secret: TEST_SECRET, userId: U1, autoPublish: true });
      expect(out.dropped).toEqual(['scalp massage']);
      expect((out.siteData.extraPages as any).svcCopy).toBeUndefined();
    });
  }
  it('a signature issued to another account is refused wherever the signed-in owner is known (draft save, publish)', () => {
    const theirs = withCopy({ 'scalp massage': sign('owner', 'scalp massage', U2) });
    expect(svcCopySanitize(theirs, { secret: TEST_SECRET, userId: U1 }).dropped).toEqual(['scalp massage']);
    expect(svcCopySanitize(theirs, { secret: TEST_SECRET, userId: U2 }).dropped).toEqual([]);
  });
  it('the signed original, by contrast, survives every one of those steps (so the tests above would notice a gate that blocks everything)', async () => {
    const d = withCopy({ 'scalp massage': sign() });
    const r = validateWebSnapshot(d, () => []);
    expect(Object.keys((r.sd.extraPages as any).svcCopy)).toEqual(['scalp massage']);
    expect(everything(deploy(r.pendingData))).toContain(MARK);
    expect(svcCopySanitize(d, { secret: TEST_SECRET, userId: U1 }).dropped).toEqual([]);
  });
  it('an auto-signed entry prints on the deploy render only while the flag is on, and a signed owner entry prints regardless (S1)', async () => {
    const auto = withCopy({ 'scalp massage': sign('auto') });
    await flag(false, () => expect(everything(deploy(auto))).not.toContain(MARK));
    await flag(true, () => expect(everything(deploy(auto))).toContain(MARK));
    const owner = withCopy({ 'scalp massage': sign('owner') });
    await flag(false, () => expect(everything(deploy(owner))).toContain(MARK));
    // the pure renderer (also the browser preview) never prints 'auto' by itself
    expect(everything(renderSiteBundle(auto, BASE))).not.toContain(MARK);
  });
  it('with no signing secret configured no model text prints on any server path (fail closed)', async () => {
    const prev = process.env.SERVICE_COPY_SIGNING_SECRET;
    delete process.env.SERVICE_COPY_SIGNING_SECRET;
    try {
      const d = withCopy({ 'scalp massage': sign('owner') });
      expect(everything(deploy(d))).not.toContain(MARK);
      expect((validateWebSnapshot(d, () => []).sd.extraPages as any).svcCopy).toBeUndefined();
    } finally { process.env.SERVICE_COPY_SIGNING_SECRET = prev; }
  });
  it('the barber\'s own words (aiGenerated false) are not model text: they print without any signature, and cannot carry approval fields', () => {
    const own = { v: 1, aiGenerated: false, intro: 'My own words about the massage.', sections: [], faq: [] };
    expect(everything(deploy(withCopy({ 'scalp massage': own })))).toContain('My own words about the massage.');
    const stamped = svcCopySanitize(withCopy({ 'scalp massage': { ...own, approval: 'owner' } }), { secret: TEST_SECRET });
    expect(stampedDropped(stamped)).toBe(true);
  });
  it('a signed entry stays attached to the service it was issued for: after a rename the old key text never resurfaces', () => {
    const renamed = site({ extraPages: { on: ['faq'], serviceGuides: true, seed: 7, svcCopy: { 'scalp massage': sign() } } }, ['Scalp Ritual']);
    expect(everything(deploy(renamed))).not.toContain(MARK);
  });
  it('an iOS-sourced or legacy site never prints model text whatever its data says', () => {
    for (const source of [undefined, 'ios']) {
      const b = deploy({ ...withCopy({ 'scalp massage': sign() }), source });
      expect(everything(b)).not.toContain(MARK);
    }
  });
});
function stampedDropped(o: { dropped: string[] }): boolean { return o.dropped.length === 1; }

describe('forging approval through the real publish flow (runWebPublish)', () => {
  const USER = U1;
  const fakes = (userId = USER) => {
    const written: PendingSite[] = [];
    const sites = new Map<string, any>();
    const owners = new Map<string, any>();
    const pending = new Map<string, PendingSite>();
    const deps = {
      environment: 'live' as const,
      userOf: vi.fn(async () => ({ id: userId, email: 'o@example.com' })),
      entitlementOf: vi.fn(async () => ({ stripe_subscription_id: 'sub_1', stripe_customer_id: 'cus_1', user_id: userId, site_slug: null, tier: 'website', billing_interval: 'month', status: 'active', environment: 'live', current_period_end: null, cancel_at_period_end: false })),
      sites: {
        byUser: vi.fn(async () => [...sites.values()][0] ?? null), get: vi.fn(async (s: string) => sites.get(s) ?? null),
        insertIfAbsent: vi.fn(async (r: any) => { sites.set(r.slug, { ...r, published_at: null, taken_down_at: null, removed_at: null }); return true; }),
        releaseUnpublished: vi.fn(async () => {}), markPublished: vi.fn(async () => {}),
      },
      owners: { get: vi.fn(async (s: string) => owners.get(s) ?? null), insertIfAbsent: vi.fn(async (r: any) => { if (owners.has(r.slug)) return false; owners.set(r.slug, r); return true; }) },
      isTaken: vi.fn(async () => false), readPending: vi.fn(async (s: string) => pending.get(s) ?? null), writePending: vi.fn(async (s: string, p: PendingSite) => { pending.set(s, p); written.push(p); }),
      publish: vi.fn(async (slug: string) => ({ ok: true, siteId: slug, deployedUrl: `https://${slug}.vercel.app` })),
      render: () => [], rememberSlug: vi.fn(async () => {}), now: () => 1_800_000_000_000,
    } as unknown as WebPublishDeps;
    return { deps, written };
  };
  const stored = (w: PendingSite[]) => (w.at(-1)?.siteData as any)?.extraPages?.svcCopy;
  it('a signed entry of the signed-in owner is stored; every forgery and another owner\'s signed entry is not', async () => {
    const ok = fakes();
    const r = await runWebPublish({ siteData: withCopy({ 'scalp massage': sign('owner', 'scalp massage', U1) }) }, ok.deps, { authorization: 'Bearer t' });
    expect(r.status).toBe(200); expect(Object.keys(stored(ok.written))).toEqual(['scalp massage']);
    for (const [label, make] of FORGERIES) {
      const f = fakes();
      const res = await runWebPublish({ siteData: withCopy({ 'scalp massage': make() }) }, f.deps, { authorization: 'Bearer t' });
      expect(res.status, label).toBe(200);
      expect(stored(f.written), label).toBeUndefined();
    }
    // a perfectly valid signature that was issued to ANOTHER account, published by this one
    const theft = fakes(U2);
    await runWebPublish({ siteData: withCopy({ 'scalp massage': sign('owner', 'scalp massage', U1) }) }, theft.deps, { authorization: 'Bearer t' });
    expect(stored(theft.written)).toBeUndefined();
  });
  it('with the flag off, a signed auto entry is not stored either', async () => {
    await flag(false, async () => {
      const f = fakes();
      await runWebPublish({ siteData: withCopy({ 'scalp massage': sign('auto') }) }, f.deps, { authorization: 'Bearer t' });
      expect(stored(f.written)).toBeUndefined();
    });
  });
});

describe('families cannot be forged either: the title itself decides', () => {
  const famSite = (title: string, family: string) => site({ extraPages: { on: ['faq'], serviceGuides: true, seed: 7, svcFamily: { [title.toLowerCase()]: family } } }, [title]);
  it('a family without a keyword in the title is dropped on every server step and never renders library wording', async () => {
    for (const [t, f] of [['Scalp Massage', 'shave'], ['Gel Manicure', 'color'], ['Brow Wax', 'shave'], ['Platinum Experience', 'color'], ['Locs Retwist', 'haircut'], ['Bald Head Polish', 'color']] as const) {
      const d = famSite(t, f);
      expect((svcCopySanitize(d, { secret: TEST_SECRET }).siteData.extraPages as any).svcFamily, `${t}/${f}`).toBeUndefined();
      expect((validateWebSnapshot(d, () => []).sd.extraPages as any).svcFamily).toBeUndefined();
      const b = deploy(d);
      const slug = t.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      expect(b.pages.find((p) => p.path === `services/${slug}/index.html`)?.html ?? '', `${t}/${f}`).not.toContain('About this service');
      expect(b.sitemap ?? '').not.toContain(`/services/${slug}/`);
    }
    // and the allowed one survives and renders
    const ok = famSite('Bald Head Polish', 'shave');
    expect((validateWebSnapshot(ok, () => []).sd.extraPages as any).svcFamily).toEqual({ 'bald head polish': 'shave' });
    expect(deploy(ok).pages.find((p) => p.path === 'services/bald-head-polish/index.html')?.html).toContain('About this service');
  });
});

describe('structural: every render a deploy ships goes through the one checked chokepoint', () => {
  const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (['node_modules', 'tests', 'supabase', '.git', 'dist'].includes(e.name) ? [] : walk(path.join(dir, e.name))) : e.name.endsWith('.ts') ? [path.join(dir, e.name)] : []));
  it('renderSiteBundle is called only inside lib/render and inside renderPendingBundle (lib/publishSite.ts)', () => {
    const root = path.resolve(__dirname, '../..');
    const offenders = [...walk(path.join(root, 'lib')), ...walk(path.join(root, 'api'))].filter((f) => !f.includes(`${path.sep}lib${path.sep}render${path.sep}`)).filter((f) => /\brenderSite(?:Bundle)?\(/.test(fs.readFileSync(f, 'utf8')));
    expect(offenders.map((f) => path.relative(root, f))).toEqual(['lib/publishSite.ts']);
    const src = fs.readFileSync(path.join(root, 'lib/publishSite.ts'), 'utf8');
    expect(src.match(/renderSiteBundle\(/g)?.length).toBe(1);
    expect(src).toMatch(/svcCopySanitize\(pending\.siteData[\s\S]*?secret: signingSecret\(\)[\s\S]*?forRender: true/);
  });
});
