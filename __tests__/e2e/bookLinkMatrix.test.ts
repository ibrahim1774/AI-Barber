/**
 * Every combination of the Book-link decision as publish sends it:
 * choice (own / aibarber / unset) x own link (yes / no) x entitlements
 * (unknown, lapsed, Website, Bookings, Store) x link context (unknown, no
 * shop, shop with bookingsEnabled x purchaseLinked) x store open.
 *
 * Rule (spec): AI Barber's link only when the choice is aibarber AND the
 * bookings entitlement is active AND a shop exists AND bookingsEnabled AND
 * purchaseLinked; else the barber's own link; else no Book button. The Shop
 * link only with store + linked shop + store open. By design nothing is
 * decided while the entitlements are unknown or hosting isn't visibly active.
 * Fail closed: when the context is unknown (shop lookup failed, signed out) or the
 * entitlements are not confirmed, a site that is already published sends nothing
 * if it carries the built-in /book (publish stays pending, friendly retry);
 * everything else is sent as is, a plan-lacking AI link falling back to the own link.
 */
import * as store from '@/lib/siteStore';
import { publishFlow, type PublishDeps } from '@/lib/publish';
import { resetEntitlementsForTests, setEntitlementsFromStatus, getEntitlements } from '@/lib/entitlements';
import { bookingPrefs, withChoice, syncOwnLink, resolveLinks, type LinkContext } from '@/lib/bookingChoice';
import { stripLapsedLinks } from '@/lib/tierLinks';
import type { SiteRecord } from '@/lib/siteStore';

const OWN = 'https://booksy.com/en-us/123_fade-lab';
// The site's own pages (relative): what publish sends now.
const AI = '/book';
const SHOP = '/shop';

type Ents = 'unknown' | 'lapsed' | 'website' | 'bookings' | 'store';
type Ctx = 'unknown' | 'no-shop' | 'shop';
type Choice = 'own' | 'aibarber' | 'unset';

const ENTS: Record<Ents, () => void> = {
  unknown: () => resetEntitlementsForTests(),
  lapsed: () => setEntitlementsFromStatus({ status: 'INACTIVE' }),
  website: () => setEntitlementsFromStatus({ status: 'ACTIVE', entitlements: [{ id: 'hosting' }] }),
  bookings: () => setEntitlementsFromStatus({ status: 'ACTIVE', entitlements: [{ id: 'hosting' }, { id: 'bookings' }] }),
  store: () => setEntitlementsFromStatus({ status: 'ACTIVE', entitlements: [{ id: 'hosting' }, { id: 'bookings' }, { id: 'store' }] }),
};

function record(choice: Choice, own: boolean): SiteRecord {
  const base = {
    draftId: 'd1',
    inputs: { shopName: 'Fade Lab', area: 'Brooklyn', phone: '555' } as SiteRecord['inputs'],
    data: {
      shopName: 'Fade Lab', area: 'Brooklyn', phone: '555',
      hero: { heading: 'h', tagline: 't', imageUrl: '' }, about: { heading: 'a', description: ['x'], imageUrl: '' },
      services: [], gallery: [],
      ...(own ? { bookingUrl: OWN } : {}),
    } as unknown as SiteRecord['data'],
    updatedAt: 1, slug: 'fade-lab', deployedUrl: 'https://fade-lab.aibarber.org', transactionId: 'tx-1',
  } as SiteRecord;
  if (own) base.inputs.ownBookingUrl = OWN;
  // What the editor saves when the barber picks (withChoice sets the data's Book link too).
  return choice === 'unset' ? base : withChoice(base, choice, { slug: 'fade-lab' });
}

const rows: { choice: Choice; own: boolean; ents: Ents; ctx: Ctx; enabled: boolean; linked: boolean; storeOpen: boolean }[] = [];
for (const choice of ['own', 'aibarber', 'unset'] as Choice[])
  for (const own of [true, false])
    for (const ents of Object.keys(ENTS) as Ents[])
      for (const ctx of ['unknown', 'no-shop', 'shop'] as Ctx[])
        for (const enabled of ctx === 'shop' ? [true, false] : [false])
          for (const linked of ctx === 'shop' ? [true, false] : [false])
            for (const storeOpen of ctx === 'shop' ? [true, false] : [false])
              rows.push({ choice, own, ents, ctx, enabled, linked, storeOpen });

/** The expected Book / Shop links (spec + the documented "server decides" / "unknown keeps" rules). */
function expected(r: (typeof rows)[number], data: SiteRecord['data']): { book?: string; shop?: string; deferred?: boolean } {
  const e = getEntitlements();
  // The test record is already published: an unconfirmed context holds back a changed (built-in) Book link.
  if ((!e.known || !e.hosting || r.ctx === 'unknown') && data.bookingUrl === AI) return { deferred: true };
  if (!e.known || !e.hosting) return { book: data.bookingUrl, shop: (data as any).shopUrl };
  const effective = r.own ? (r.choice === 'unset' ? 'own' : r.choice) : 'aibarber';
  if (r.ctx === 'unknown') {
    // Unknown shop: the site's own links stay; a link the plan lacks goes, and then the own link is the fallback.
    if (data.bookingUrl === AI && !e.bookings) return { book: r.own ? OWN : undefined };
    return { book: data.bookingUrl };
  }
  const ai = effective === 'aibarber' && e.bookings && r.ctx === 'shop' && r.enabled && r.linked;
  const shop = e.store && r.ctx === 'shop' && r.linked && r.storeOpen;
  return { book: ai ? AI : r.own ? OWN : undefined, shop: shop ? SHOP : undefined };
}

async function send(r: (typeof rows)[number]): Promise<any> {
  ENTS[r.ents]();
  const rec = record(r.choice, r.own);
  await store.saveSite(rec);
  await store.savePendingPublish(null);
  const ctx: LinkContext | null =
    r.ctx === 'unknown'
      ? null
      : {
          ents: getEntitlements(),
          shop: r.ctx === 'shop' ? { slug: 'fade-lab', bookingsEnabled: r.enabled, purchaseLinked: r.linked } : null,
          storeEnabled: r.ctx === 'shop' && r.storeOpen,
        };
  let sent: any = null;
  const deps: PublishDeps = {
    hasEntitlement: async () => true,
    showPaywall: async () => 'declined',
    latestTransactionId: async () => 'tx-1',
    iosPublish: jest.fn(async (b: any) => {
      sent = b.siteData;
      return { siteId: 'fade-lab', deployedUrl: 'https://fade-lab.aibarber.org', republished: true };
    }) as any,
    linkContext: async () => ctx,
    store,
    accessToken: async () => 'tok',
    claimStart: jest.fn(async () => ({ ok: true as const, state: 'unclaimed' as const, claimExpiresAt: '2026-11-25T00:00:00.000Z' })),
  };
  const out = await publishFlow(rec, deps);
  return { sent, rec, out };
}

const name = (r: (typeof rows)[number]) =>
  `choice=${r.choice} own=${r.own} ents=${r.ents} ctx=${r.ctx}${r.ctx === 'shop' ? ` enabled=${r.enabled} linked=${r.linked} storeOpen=${r.storeOpen}` : ''}`;

beforeEach(() => resetEntitlementsForTests());

describe('Book / Shop link matrix through publishFlow', () => {
  for (const r of rows) {
    it(name(r), async () => {
      const { sent, rec, out } = await send(r);
      const want = expected(r, rec.data);
      if (want.deferred) {
        expect(out.kind).toBe('pending');
        expect(sent).toBeNull();
        return;
      }
      expect(out.kind).toBe('live');
      expect(sent.bookingUrl).toBe(want.book);
      expect(sent.shopUrl).toBe(want.shop);
    });
  }

  it('covers every combination', () => {
    expect(rows).toHaveLength(3 * 2 * 5 * (1 + 1 + 8));
  });
});

describe('the own link through edits', () => {
  const ctx = (): LinkContext => ({ ents: getEntitlements(), shop: { slug: 'fade-lab', bookingsEnabled: true, purchaseLinked: true }, storeEnabled: false });
  const imported = (): SiteRecord => ({
    draftId: 'd1',
    // An import from a Booksy link leaves the link in the inputs too (editor.ts / account.inputsFrom).
    inputs: { shopName: 'Fade Lab', area: 'Brooklyn', phone: '555', bookingUrl: OWN, ownBookingUrl: OWN, bookingChoice: 'own' },
    data: { shopName: 'Fade Lab', area: 'Brooklyn', phone: '555', bookingUrl: OWN, hero: {}, about: {}, services: [], gallery: [] } as any,
    updatedAt: 1, slug: 'fade-lab', deployedUrl: 'https://fade-lab.aibarber.org', transactionId: 'tx-1',
  });

  // Fixed (bug 3): clearing the link deleted ownBookingUrl, but bookingPrefs fell back to
  // inputs.bookingUrl (the import's copy), so publish and the preview put the deleted link back.
  it('a Book link the barber deleted stays deleted on publish (Website plan, signed in)', () => {
    ENTS.website();
    const prev = imported();
    const next = syncOwnLink(prev, { ...prev, data: { ...prev.data, bookingUrl: '' } });
    expect(next.inputs).toMatchObject({ ownBookingCleared: true });
    expect(next.inputs.ownBookingUrl).toBeUndefined();
    const sent = stripLapsedLinks(resolveLinks(next.data, next.inputs, ctx()), getEntitlements());
    expect(sent.bookingUrl).toBeUndefined();
    // Signed out (unknown context) too.
    expect(stripLapsedLinks(next.data, getEntitlements()).bookingUrl).toBeFalsy();
  });

  it('after clearing, AI Barber booking still works, and typing a new own link replaces the cleared state', () => {
    ENTS.bookings();
    const prev = imported();
    let r = syncOwnLink(prev, { ...prev, data: { ...prev.data, bookingUrl: '' } });
    r = withChoice(r, 'aibarber', { slug: 'fade-lab' });
    expect(resolveLinks(r.data, r.inputs, ctx()).bookingUrl).toBe(AI);
    // The cleared Booksy link is never offered or derived again.
    expect(bookingPrefs(r).own).toBeNull();
    const square = 'https://squareup.com/appointments/book/abc';
    r = syncOwnLink(r, { ...r, data: { ...r.data, bookingUrl: square } });
    expect(r.inputs.ownBookingCleared).toBeUndefined();
    expect(resolveLinks(r.data, r.inputs, ctx()).bookingUrl).toBe(square);
  });

  it('switching AI Barber -> own -> AI Barber never loses the own link; a new own link replaces it', () => {
    ENTS.bookings();
    let r = withChoice(imported(), 'aibarber', { slug: 'fade-lab' });
    expect(resolveLinks(r.data, r.inputs, ctx()).bookingUrl).toBe(AI);
    r = withChoice(r, 'own', { slug: 'fade-lab' });
    expect(resolveLinks(r.data, r.inputs, ctx()).bookingUrl).toBe(OWN);
    const square = 'https://squareup.com/appointments/book/abc';
    r = syncOwnLink(r, { ...r, data: { ...r.data, bookingUrl: square } });
    expect(r.inputs).toMatchObject({ ownBookingUrl: square, bookingChoice: 'own' });
    r = withChoice(r, 'aibarber', { slug: 'fade-lab' });
    r = withChoice(r, 'own', { slug: 'fade-lab' });
    expect(resolveLinks(r.data, r.inputs, ctx()).bookingUrl).toBe(square);
  });

  it('an AI Barber link typed by hand is never taken as the own link; other shops\' AI links neither', () => {
    ENTS.bookings();
    const prev = imported();
    const next = syncOwnLink(prev, { ...prev, data: { ...prev.data, bookingUrl: 'https://aibarber.org/book/other-shop' } });
    expect(next.inputs.ownBookingUrl).toBe(OWN);
  });
});
