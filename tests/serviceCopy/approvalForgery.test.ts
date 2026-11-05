// Review 6c B2: the approval of model text is SERVER-STAMPED. A client can send any approval, family or proposal-state value on any
// save path; none of them makes text print. Model text prints only when the server's signature verifies for the exact text, service
// key, niche and (where known) owner. Everything here is pure or mocked: no model, no network.
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DRAFT_APPROVAL_TTL_MS, draftRef, entryDigest, safeEqual, signingSecret, siteRef, stampApproval, userScope, verifyApproval } from '../../lib/serviceCopy/approval';
import { svcCopySanitize } from '../../lib/serviceCopy/prune';
import { renderPendingBundle } from '../../lib/publishSite';
import { renderSiteBundle } from '../../lib/render/site';
import { validateWebSnapshot, runWebPublish, type WebPublishDeps } from '../../lib/webApp/publishFlow';
import type { PendingSite } from '../../lib/publishSite';
import { GOOD_JSON, TEST_SECRET, U1, U2, rig, site } from './helpers';

const OTHER_SECRET = 'a-different-signing-secret-ffffffff';
const NICHE = 'Barbershop';
const BASE = { siteBaseUrl: 'https://fresh.example.com' };
const MARK = 'Learn what the service involves before you decide';
const DRAFT = 'draft-1';
const SLUG = 'fresh-site';
const text = { v: 1 as const, aiGenerated: true, ...GOOD_JSON, intro: GOOD_JSON.intro, at: '2026-11-05T12:00:00.000Z' };
type Where = 'draft' | 'site' | { draft: string } | { slug: string };
const whoOf = (user: string, where: Where) => (where === 'draft' ? { userId: user, draftId: DRAFT } : where === 'site' ? { userId: user, slug: SLUG } : 'draft' in where ? { userId: user, draftId: where.draft } : { userId: user, slug: where.slug });
/** A server stamp. Default: issued to U1 for the draft 'draft-1' (what the approve endpoint returns). 'site': bound to the published slug (what publish re-stamps). */
const sign = (mode: 'owner' | 'auto' = 'owner', key = 'scalp massage', user = U1, niche = NICHE, secret = TEST_SECRET, where: Where = 'draft', now = Date.now()) => stampApproval(secret, whoOf(user, where), key, niche, text as never, mode, now) as any;
const DOPTS = { secret: TEST_SECRET, userId: U1, refs: [draftRef(DRAFT)] };
const withCopy = (copy: Record<string, unknown>, extra: Record<string, unknown> = {}) => site({ extraPages: { on: ['faq'], serviceGuides: true, seed: 7, svcCopy: copy }, ...extra });
const everything = (r: { sitemap: string | null; pages: { html: string }[] }) => [r.sitemap ?? '', ...r.pages.map((p) => p.html)].join('\n');
const deploy = (d: any, siteId: string | undefined = SLUG) => renderPendingBundle({ siteData: d, imageUrlMap: {}, siteId }, BASE);
const flag = async <T>(on: boolean, fn: () => T | Promise<T>): Promise<T> => {
  const prev = process.env.SERVICE_COPY_AUTO_PUBLISH;
  if (on) process.env.SERVICE_COPY_AUTO_PUBLISH = '1'; else delete process.env.SERVICE_COPY_AUTO_PUBLISH;
  try { return await fn(); } finally { if (prev === undefined) delete process.env.SERVICE_COPY_AUTO_PUBLISH; else process.env.SERVICE_COPY_AUTO_PUBLISH = prev; }
};

const USER = U1;
const fakes = (userId = USER, existingSlug?: string) => {
  const written: PendingSite[] = [];
  const sites = new Map<string, any>();
  const owners = new Map<string, any>();
  const pending = new Map<string, PendingSite>();
  if (existingSlug) {
    sites.set(existingSlug, { slug: existingSlug, user_id: userId, stripe_subscription_id: 'sub_1', environment: 'live', published_at: '2026-10-01T00:00:00Z', taken_down_at: null, removed_at: null });
    owners.set(existingSlug, { slug: existingSlug, user_id: userId, source: 'checkout', checkout_session_id: 'webapp:sub_1' });
  }
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

describe('the signature itself', () => {
  it('a stamped entry verifies for exactly its service key, niche and owner', () => {
    const e = sign();
    expect(e.approval).toBe('owner'); expect(e.approvalSig).toMatch(/^[0-9a-f]{64}$/); expect(e.approvalScope).toBe(userScope(TEST_SECRET, U1));
    expect(verifyApproval(TEST_SECRET, e, 'scalp massage', NICHE)).toBe(true);
    expect(verifyApproval(TEST_SECRET, e, 'scalp massage', NICHE, { userId: U1, refs: [draftRef(DRAFT)] })).toBe(true);
    expect(verifyApproval(TEST_SECRET, e, 'scalp massage', NICHE, { userId: U2 })).toBe(false);       // another owner
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
      { ...e, approvalSig: undefined }, { ...e, approvalScope: undefined }, { ...e, approvalRef: siteRef(SLUG) }, { ...e, approvalRef: undefined }, { ...e, approvalAt: e.approvalAt + 1 }, { ...e, approvalAt: undefined }, { ...e, aiGenerated: false }, { ...e, approvalSig: 'x'.repeat(64) },
    ];
    for (const b of bad) expect(verifyApproval(TEST_SECRET, b, 'scalp massage', NICHE), JSON.stringify(Object.keys(b).length)).toBe(false);
  });
  it('the signature binds the label: an owner stamp cannot be relabelled auto and an auto stamp cannot be relabelled owner', () => {
    expect(verifyApproval(TEST_SECRET, { ...sign('owner'), approval: 'auto' }, 'scalp massage', NICHE)).toBe(false);
    expect(verifyApproval(TEST_SECRET, { ...sign('auto'), approval: 'owner' }, 'scalp massage', NICHE)).toBe(false);
  });
  it('no secret, a short secret or an unusable entry: nothing is stamped, nothing verifies', () => {
    expect(signingSecret({})).toBeNull(); expect(signingSecret({ SERVICE_COPY_SIGNING_SECRET: 'short' })).toBeNull(); expect(signingSecret({ SERVICE_COPY_SIGNING_SECRET: TEST_SECRET })).toBe(TEST_SECRET);
    expect(stampApproval(null, { userId: U1, draftId: DRAFT }, 'k', NICHE, text as never, 'owner')).toBeNull();
    expect(stampApproval(TEST_SECRET, { userId: U1 }, 'k', NICHE, text as never, 'owner')).toBeNull();   // nothing to bind to
    expect(stampApproval(TEST_SECRET, { userId: U1, draftId: DRAFT, slug: SLUG }, 'k', NICHE, text as never, 'owner')?.approvalRef).toBe(siteRef(SLUG));   // a site wins over a draft
    expect(stampApproval(TEST_SECRET, { userId: U1, draftId: DRAFT }, 'k', NICHE, { v: 2 } as never, 'owner')).toBeNull();
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
const FORGERIES: [string, (w: Where) => any][] = [
  ['an owner stamp written by the client (no signature)', () => ({ ...text, approval: 'owner' })],
  ['an auto stamp written by the client', () => ({ ...text, approval: 'auto' })],
  ['a made-up signature and scope', () => ({ ...text, approval: 'owner', approvalSig: 'a'.repeat(64), approvalScope: 'b'.repeat(32) })],
  ['a made-up signature, scope, ref and time', () => ({ ...text, approval: 'owner', approvalSig: 'a'.repeat(64), approvalScope: userScope(TEST_SECRET, U1), approvalRef: siteRef(SLUG), approvalAt: Date.now() })],
  ['a signature taken from another service, moved under this key', (w) => sign('owner', 'eyebrow styling', U1, NICHE, TEST_SECRET, w)],
  ['a signature made with another secret', (w) => sign('owner', 'scalp massage', U1, NICHE, OTHER_SECRET, w)],
  ['a signed entry whose text was edited afterwards', (w) => ({ ...sign('owner', 'scalp massage', U1, NICHE, TEST_SECRET, w), intro: sign().intro.replace('Learn', 'Study') })],
  ['a signed entry for another niche', (w) => sign('owner', 'scalp massage', U1, 'Nail Salon', TEST_SECRET, w)],
  ['an owner stamp relabelled auto', (w) => ({ ...sign('owner', 'scalp massage', U1, NICHE, TEST_SECRET, w), approval: 'auto' })],
  ['a proposal state field the server never set', () => ({ ...text, approval: 'owner', state: 'approved' })],
  ['a family-approval field on the entry', (w) => ({ ...sign('owner', 'scalp massage', U1, NICHE, TEST_SECRET, w), familyApproved: true })],
  ['a signed entry of another SITE (replay: bound to a different slug)', () => sign('owner', 'scalp massage', U1, NICHE, TEST_SECRET, { slug: 'someone-elses-site' })],
  ['a signed entry of another DRAFT (replay: bound to a different draft id)', () => sign('owner', 'scalp massage', U1, NICHE, TEST_SECRET, { draft: 'other-draft' })],
  ['a signed entry with its ref swapped to this site (draft stamp relabelled as the site)', (w) => ({ ...sign('owner', 'scalp massage', U1, NICHE, TEST_SECRET, w), approvalRef: siteRef('fresh-site-2') })],
  ['an expired draft stamp (31 days old)', () => sign('owner', 'scalp massage', U1, NICHE, TEST_SECRET, 'draft', Date.now() - DRAFT_APPROVAL_TTL_MS - 24 * 3600 * 1000)],
  ['a stamp issued in the future', () => sign('owner', 'scalp massage', U1, NICHE, TEST_SECRET, 'draft', Date.now() + 3600 * 1000)],
];

/** Genuine server signatures whose binding (draft, site, time) is wrong for the step that sees them: only a step that knows the context can refuse them. */
const CONTEXT_ONLY = new Set(['a signed entry of another SITE (replay: bound to a different slug)', 'a signed entry of another DRAFT (replay: bound to a different draft id)', 'an expired draft stamp (31 days old)', 'a stamp issued in the future']);

describe('forging approval on every path: nothing prints', () => {
  for (const [label, make] of FORGERIES) {
    it(`deploy render (renderPending: admin redeploy, lapse restore, sweeper, webhook, save-pending-site, iOS re-save, preview of a pending copy): ${label}`, async () => {
      for (const on of [false, true]) await flag(on, () => {
        const b = deploy(withCopy({ 'scalp massage': make('site') }));
        expect(everything(b), `flag ${on}`).not.toContain(MARK);
        expect(b.sitemap ?? '').not.toContain('/services/scalp-massage/');
      });
    });
    it(`publish snapshot (validateWebSnapshot, signature check before the caller is known): ${label}`, async () => {
      if (CONTEXT_ONLY.has(label)) return; // a genuine signature for another draft/site/time: the authenticated step (runWebPublish test below) refuses it
      for (const on of [false, true]) await flag(on, () => {
        const r = validateWebSnapshot(withCopy({ 'scalp massage': make('draft') }), () => []);
        expect((r.sd.extraPages as any).svcCopy, `flag ${on}`).toBeUndefined();
        expect((r.pendingData.extraPages as any).svcCopy).toBeUndefined();
      });
    });
    it(`server cleaning step used by the draft save, a 3-way merge result and an old-client re-save: ${label}`, () => {
      const out = svcCopySanitize(withCopy({ 'scalp massage': make('draft') }), { ...DOPTS, autoPublish: true });
      expect(out.dropped).toEqual(['scalp massage']);
      expect((out.siteData.extraPages as any).svcCopy).toBeUndefined();
    });
  }
  it('CROSS-ACCOUNT replay: a signature minted for account A never validates for account B (draft save, publish, deploy render, save-pending-site)', () => {
    const theirs = withCopy({ 'scalp massage': sign('owner', 'scalp massage', U2) });
    expect(svcCopySanitize(theirs, DOPTS).dropped).toEqual(['scalp massage']);
    expect(svcCopySanitize(theirs, { secret: TEST_SECRET, userId: U2, refs: [draftRef(DRAFT)] }).dropped).toEqual([]);
    // the same on a published-site stamp: B's site cannot carry A's stamp even when the slug matches (the scope is the account)
    const siteTheirs = withCopy({ 'scalp massage': sign('owner', 'scalp massage', U2, NICHE, TEST_SECRET, 'site') });
    expect(svcCopySanitize(siteTheirs, { secret: TEST_SECRET, userId: U1, refs: [siteRef(SLUG)] }).dropped).toEqual(['scalp massage']);
    expect(svcCopySanitize(siteTheirs, { secret: TEST_SECRET, userId: U2, refs: [siteRef(SLUG)] }).dropped).toEqual([]);
  });
  it('CROSS-SITE replay: a signature minted for site X never validates on site Y, on the deploy render or at save-pending-site', () => {
    const x = withCopy({ 'scalp massage': sign('owner', 'scalp massage', U1, NICHE, TEST_SECRET, { slug: 'site-x' }) });
    expect(everything(deploy(x, 'site-x'))).toContain(MARK);
    expect(everything(deploy(x, 'site-y'))).not.toContain(MARK);
    expect(everything(deploy(x, undefined))).not.toContain(MARK);      // a render that does not know its site prints nothing
    expect(everything(deploy(x, ''))).not.toContain(MARK);
    expect(svcCopySanitize(x, { secret: TEST_SECRET, userId: U1, refs: [siteRef('site-y')] }).dropped).toEqual(['scalp massage']);
    expect(svcCopySanitize(x, { secret: TEST_SECRET, userId: U1 }).dropped).toEqual(['scalp massage']);   // no refs given = nothing kept
    // a stamp for one DRAFT is not good for another draft of the same account
    const d1 = withCopy({ 'scalp massage': sign('owner', 'scalp massage', U1, NICHE, TEST_SECRET, { draft: 'draft-a' }) });
    expect(svcCopySanitize(d1, { secret: TEST_SECRET, userId: U1, refs: [draftRef('draft-b')] }).dropped).toEqual(['scalp massage']);
    expect(svcCopySanitize(d1, { secret: TEST_SECRET, userId: U1, refs: [draftRef('draft-a')] }).dropped).toEqual([]);
    // a draft stamp never prints on a deploy render, even one that names the draft id as the site id
    expect(everything(deploy(withCopy({ 'scalp massage': sign() }), DRAFT))).not.toContain(MARK);
  });
  it('EXPIRY: a draft stamp is good for 30 days; a site stamp does not expire (deploys re-render for years); a future stamp is refused', () => {
    const now = Date.now();
    const old = sign('owner', 'scalp massage', U1, NICHE, TEST_SECRET, 'draft', now - DRAFT_APPROVAL_TTL_MS + 60_000);
    const dead = sign('owner', 'scalp massage', U1, NICHE, TEST_SECRET, 'draft', now - DRAFT_APPROVAL_TTL_MS - 60_000);
    expect(verifyApproval(TEST_SECRET, old, 'scalp massage', NICHE, { userId: U1, refs: [draftRef(DRAFT)], now })).toBe(true);
    expect(verifyApproval(TEST_SECRET, dead, 'scalp massage', NICHE, { userId: U1, refs: [draftRef(DRAFT)], now })).toBe(false);
    const ancientSite = sign('owner', 'scalp massage', U1, NICHE, TEST_SECRET, 'site', now - 5 * 365 * 24 * 3600 * 1000);
    expect(verifyApproval(TEST_SECRET, ancientSite, 'scalp massage', NICHE, { refs: [siteRef(SLUG)], now })).toBe(true);
    expect(everything(deploy(withCopy({ 'scalp massage': ancientSite })))).toContain(MARK);
    const future = sign('owner', 'scalp massage', U1, NICHE, TEST_SECRET, 'site', now + 3600_000);
    expect(verifyApproval(TEST_SECRET, future, 'scalp massage', NICHE, { refs: [siteRef(SLUG)], now })).toBe(false);
    expect(verifyApproval(TEST_SECRET, future, 'scalp massage', NICHE, { refs: [siteRef(SLUG)], now: now + 3600_000 })).toBe(true);
  });
  it('the compare is constant-time (timingSafeEqual on the signature, safeEqual on scope and ref)', () => {
    expect(safeEqual('abc', 'abc')).toBe(true); expect(safeEqual('abc', 'abd')).toBe(false); expect(safeEqual('abc', 'abcd')).toBe(false); expect(safeEqual('', '')).toBe(true);
    const src = fs.readFileSync(path.resolve(__dirname, '../../lib/serviceCopy/approval.ts'), 'utf8');
    expect(src).toMatch(/timingSafeEqual\(want, got\)/);
    expect(src).not.toMatch(/approvalSig\s*===|===\s*e\.approvalSig|approvalScope\s*===|===\s*e\.approvalScope|approvalRef\s*===/);
  });
  it('PUBLISH re-stamps verified text to the site: the pending copy carries a site-bound stamp, prints on the deploy render for that slug only, and the draft stamp is not what is stored', () => {
    const d = withCopy({ 'scalp massage': sign() });
    const out = svcCopySanitize(d, { ...DOPTS, refs: [draftRef(DRAFT), siteRef(SLUG)], rebindToSlug: SLUG });
    const e = (out.siteData.extraPages as any).svcCopy['scalp massage'];
    expect(e.approvalRef).toBe(siteRef(SLUG)); expect(e.approvalScope).toBe(userScope(TEST_SECRET, U1));
    expect(everything(deploy(out.siteData, SLUG))).toContain(MARK);
    expect(everything(deploy(out.siteData, 'other-site'))).not.toContain(MARK);
    // an unverified entry is never re-stamped (the re-stamp is not a way to launder a forgery)
    const forged = svcCopySanitize(withCopy({ 'scalp massage': { ...text, approval: 'owner' } }), { ...DOPTS, rebindToSlug: SLUG });
    expect((forged.siteData.extraPages as any).svcCopy).toBeUndefined();
    // another account's stamp is not re-stamped to this account's site
    const theirs = svcCopySanitize(withCopy({ 'scalp massage': sign('owner', 'scalp massage', U2) }), { ...DOPTS, rebindToSlug: SLUG });
    expect((theirs.siteData.extraPages as any).svcCopy).toBeUndefined();
  });
  it('the signed original, by contrast, survives every one of those steps (so the tests above would notice a gate that blocks everything)', async () => {
    const d = withCopy({ 'scalp massage': sign() });
    const r = validateWebSnapshot(d, () => []);
    expect(Object.keys((r.sd.extraPages as any).svcCopy)).toEqual(['scalp massage']);
    expect(svcCopySanitize(d, DOPTS).dropped).toEqual([]);
    const live = svcCopySanitize(r.pendingData, { ...DOPTS, refs: [draftRef(DRAFT), siteRef(SLUG)], rebindToSlug: SLUG }).siteData;
    expect(everything(deploy(live))).toContain(MARK);
  });
  it('an auto-signed entry prints on the deploy render only while the flag is on, and a signed owner entry prints regardless (S1)', async () => {
    const auto = withCopy({ 'scalp massage': sign('auto', 'scalp massage', U1, NICHE, TEST_SECRET, 'site') });
    await flag(false, () => expect(everything(deploy(auto))).not.toContain(MARK));
    await flag(true, () => expect(everything(deploy(auto))).toContain(MARK));
    const owner = withCopy({ 'scalp massage': sign('owner', 'scalp massage', U1, NICHE, TEST_SECRET, 'site') });
    await flag(false, () => expect(everything(deploy(owner))).toContain(MARK));
    // the pure renderer (also the browser preview) never prints 'auto' by itself
    expect(everything(renderSiteBundle(auto, BASE))).not.toContain(MARK);
  });
  it('SECRET UNSET or too short: nothing prints or is stored on any server path, nothing throws or 500s, and the log line names the variable without any value', async () => {
    const prev = process.env.SERVICE_COPY_SIGNING_SECRET;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      for (const v of [undefined, '', 'short-secret']) {
        if (v === undefined) delete process.env.SERVICE_COPY_SIGNING_SECRET; else process.env.SERVICE_COPY_SIGNING_SECRET = v;
        const d = withCopy({ 'scalp massage': sign('owner', 'scalp massage', U1, NICHE, TEST_SECRET, 'site') });
        expect(() => deploy(d)).not.toThrow();
        expect(everything(deploy(d))).not.toContain(MARK);
        expect((validateWebSnapshot(withCopy({ 'scalp massage': sign() }), () => []).sd.extraPages as any).svcCopy).toBeUndefined();
        const f = fakes();
        const r = await runWebPublish({ siteData: withCopy({ 'scalp massage': sign() }) }, f.deps, { authorization: 'Bearer t', draftId: DRAFT });
        expect(r.status).toBe(200);
        expect(stored(f.written)).toBeUndefined();
      }
      const lines = warn.mock.calls.map((c) => c.join(' ')).filter((l) => l.includes('SERVICE_COPY_SIGNING_SECRET'));
      expect(lines.length).toBeGreaterThan(0);
      for (const l of lines) { expect(l).not.toContain(TEST_SECRET); expect(l).not.toContain('short-secret'); }
    } finally { process.env.SERVICE_COPY_SIGNING_SECRET = prev; warn.mockRestore(); }
  });
  it('SECRET ROTATED: every earlier approval stops verifying everywhere (text drops, pages go thin); a fresh stamp under the new secret works', () => {
    const NEW = 'rotated-signing-secret-1234567890ab';
    const prev = process.env.SERVICE_COPY_SIGNING_SECRET;
    const d = withCopy({ 'scalp massage': sign('owner', 'scalp massage', U1, NICHE, TEST_SECRET, 'site') });
    try {
      expect(everything(deploy(d))).toContain(MARK);
      process.env.SERVICE_COPY_SIGNING_SECRET = NEW;
      expect(everything(deploy(d))).not.toContain(MARK);
      expect(svcCopySanitize(withCopy({ 'scalp massage': sign() }), { secret: NEW, userId: U1, refs: [draftRef(DRAFT)] }).dropped).toEqual(['scalp massage']);
      const fresh = withCopy({ 'scalp massage': sign('owner', 'scalp massage', U1, NICHE, NEW, 'site') });
      expect(everything(deploy(fresh))).toContain(MARK);
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

describe('the endpoints stamp the approval, and only with a signing secret', () => {
  it('approve returns an entry the server verifies; with no secret it answers 503 and the proposal row is left unapproved', async () => {
    const r = rig({ autoPublish: false });
    await r.call({ titleKey: 'scalp massage', mode: 'write' });
    const a = await r.call({ titleKey: 'scalp massage', mode: 'approve' });
    expect(verifyApproval(TEST_SECRET, a.body.copy, 'scalp massage', NICHE, { userId: U1, refs: [draftRef('draft-1')], now: r.clock.t })).toBe(true);
    expect(a.body.copy.approvalRef).toBe('d:draft-1');
    const n = rig({ autoPublish: false, secret: null });
    await n.call({ titleKey: 'scalp massage', mode: 'write' });
    const res = await n.call({ titleKey: 'scalp massage', mode: 'approve' });
    // no secret: the whole feature answers as if it were off (404), with a log line that names the variable and no value
    expect([res.code, res.body]).toEqual([404, { error: 'not_found' }]);
    expect(n.logs.some((l) => l.includes('SERVICE_COPY_SIGNING_SECRET'))).toBe(true);
    expect(n.logs.join('\n')).not.toContain(TEST_SECRET);
    expect(n.store.rows.size).toBe(0);
  });
  it('write with the flag on and no secret is OFF (404): nothing can be issued, nothing is generated', async () => {
    const n = rig({ autoPublish: true, secret: null });
    const res = await n.call({ titleKey: 'scalp massage', mode: 'write' });
    expect(res.code).toBe(404);   // feature off without a secret: nothing is generated, nothing is stored, no model call is made
    expect(n.model.calls.length).toBe(0); expect(n.store.rows.size).toBe(0);
  });
  it('a client cannot ask the endpoint for a stamp: body fields are ignored and a proposal comes back unstamped', async () => {
    const r = rig({ autoPublish: false });
    const res = await r.call({ titleKey: 'scalp massage', mode: 'write', approval: 'owner', approvalSig: 'a'.repeat(64), copy: { ...text, approval: 'owner' } });
    expect(res.body.status).toBe('proposal'); expect(res.body.copy.approval).toBeUndefined();
  });
});

describe('forging approval through the real publish flow (runWebPublish)', () => {
  it('a signed entry of the signed-in owner is stored; every forgery and another owner\'s signed entry is not', async () => {
    const ok = fakes();
    const r = await runWebPublish({ siteData: withCopy({ 'scalp massage': sign('owner', 'scalp massage', U1) }) }, ok.deps, { authorization: 'Bearer t', draftId: DRAFT });
    expect(r.status).toBe(200); expect(Object.keys(stored(ok.written))).toEqual(['scalp massage']);
    // stored re-stamped to the new site's slug (not the draft), bound to this account
    const slug = ok.written.at(-1)!.siteId;
    expect(stored(ok.written)['scalp massage'].approvalRef).toBe(siteRef(slug));
    expect(everything(deploy(ok.written.at(-1)!.siteData, slug))).toContain(MARK);
    expect(everything(deploy(ok.written.at(-1)!.siteData, 'another-site'))).not.toContain(MARK);
    for (const [label, make] of FORGERIES) {
      const f = fakes();
      const res = await runWebPublish({ siteData: withCopy({ 'scalp massage': make('draft') }) }, f.deps, { authorization: 'Bearer t', draftId: DRAFT });
      expect(res.status, label).toBe(200);
      expect(stored(f.written), label).toBeUndefined();
    }
    // a perfectly valid signature that was issued to ANOTHER account, published by this one
    const theft = fakes(U2);
    await runWebPublish({ siteData: withCopy({ 'scalp massage': sign('owner', 'scalp massage', U1) }) }, theft.deps, { authorization: 'Bearer t', draftId: DRAFT });
    expect(stored(theft.written)).toBeUndefined();
    // a valid stamp of this account for ANOTHER draft is not the draft being published
    const other = fakes();
    await runWebPublish({ siteData: withCopy({ 'scalp massage': sign('owner', 'scalp massage', U1, NICHE, TEST_SECRET, { draft: 'draft-2' }) }) }, other.deps, { authorization: 'Bearer t', draftId: DRAFT });
    expect(stored(other.written)).toBeUndefined();
    // and with no draft id at all (a legacy publish) a draft stamp is not accepted
    const legacy = fakes();
    await runWebPublish({ siteData: withCopy({ 'scalp massage': sign() }) }, legacy.deps, { authorization: 'Bearer t' });
    expect(stored(legacy.written)).toBeUndefined();
  });
  it('REPUBLISH of an existing site: text stamped to that site is kept without any draft id; a stamp for any other site, or another account, is not', async () => {
    const ok = fakes(U1, 'my-shop');
    const r = await runWebPublish({ siteData: withCopy({ 'scalp massage': sign('owner', 'scalp massage', U1, NICHE, TEST_SECRET, { slug: 'my-shop' }) }) }, ok.deps, { authorization: 'Bearer t' });
    expect(r.status).toBe(200); expect(Object.keys(stored(ok.written) ?? {})).toEqual(['scalp massage']);
    for (const bad of [sign('owner', 'scalp massage', U1, NICHE, TEST_SECRET, { slug: 'not-my-shop' }), sign('owner', 'scalp massage', U2, NICHE, TEST_SECRET, { slug: 'my-shop' })]) {
      const f = fakes(U1, 'my-shop');
      await runWebPublish({ siteData: withCopy({ 'scalp massage': bad }) }, f.deps, { authorization: 'Bearer t' });
      expect(stored(f.written)).toBeUndefined();
    }
  });
  it('with the flag off, a signed auto entry is not stored either', async () => {
    await flag(false, async () => {
      const f = fakes();
      await runWebPublish({ siteData: withCopy({ 'scalp massage': sign('auto') }) }, f.deps, { authorization: 'Bearer t', draftId: DRAFT });
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
