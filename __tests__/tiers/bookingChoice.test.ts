import {
  bookingPrefs, migrateBooking, resolveLinks, shortLink, syncOwnLink, withChoice, type LinkContext,
} from '@/lib/bookingChoice';

const AI = 'https://www.aibarber.org/book/fade-lab';
const OWN = 'https://booksy.com/en-us/1_fade-lab';
const rec = (data: Record<string, unknown> = {}, inputs: Record<string, unknown> = {}): any => ({
  draftId: 'd', inputs: { shopName: 'Fade', area: '', phone: '', ...inputs }, data: { shopName: 'Fade', phone: '1', ...data },
  updatedAt: 1, slug: null, deployedUrl: null, transactionId: null,
});
const ents = (o: Record<string, boolean> = {}) => ({ known: true, hosting: true, bookings: false, store: false, ...o });
const shop = { slug: 'fade-lab', purchaseLinked: true };
const ctx = (o: Partial<LinkContext> & { e?: Record<string, boolean> } = {}): LinkContext => ({
  ents: ents(o.e), shop: 'shop' in o ? (o.shop as any) : shop, storeEnabled: o.storeEnabled ?? true,
});

describe('prefs and migration', () => {
  it('an own link defaults to own; none defaults to aibarber', () => {
    expect(bookingPrefs(rec({ bookingUrl: OWN }))).toEqual({ own: OWN, choice: 'own' });
    expect(bookingPrefs(rec())).toEqual({ own: null, choice: 'aibarber' });
  });
  it('an old record with an AI Barber link is aibarber', () => {
    expect(bookingPrefs(rec({ bookingUrl: AI })).choice).toBe('aibarber');
    expect(migrateBooking(rec({ bookingUrl: AI })).inputs.bookingChoice).toBe('aibarber');
  });
  it('migrate stores the own link and choice, and is a no-op once set', () => {
    const m = migrateBooking(rec({ bookingUrl: OWN }));
    expect(m.inputs).toMatchObject({ ownBookingUrl: OWN, bookingChoice: 'own' });
    expect(migrateBooking(m)).toBe(m);
  });
  it('shortLink keeps host and path only', () => {
    expect(shortLink('https://www.booksy.com/fade-lab/?utm=1')).toBe('booksy.com/fade-lab');
    expect(shortLink('https://x.com/' + 'a'.repeat(60)).length).toBeLessThanOrEqual(34);
  });
});

describe('withChoice (reversible, own link never lost)', () => {
  it('switching to AI Barber and back keeps the own link', () => {
    const a = withChoice(rec({ bookingUrl: OWN }), 'aibarber', shop);
    expect(a.data.bookingUrl).toBe(AI);
    expect(a.inputs).toMatchObject({ ownBookingUrl: OWN, bookingChoice: 'aibarber' });
    const b = withChoice(a, 'own', shop);
    expect(b.data.bookingUrl).toBe(OWN);
    expect(b.inputs.bookingChoice).toBe('own');
  });
  it('with no own link, own removes the Book link', () => {
    expect(withChoice(rec({ bookingUrl: AI }), 'own', shop).data.bookingUrl).toBeUndefined();
  });
});

describe('syncOwnLink (Contact edit updates the own link)', () => {
  it('a new non-AI link becomes the own link and the choice', () => {
    const prev = withChoice(rec({ bookingUrl: OWN }), 'aibarber', shop);
    const next = syncOwnLink(prev, { ...prev, data: { ...prev.data, bookingUrl: 'https://square.site/book/x' } });
    expect(next.inputs).toMatchObject({ ownBookingUrl: 'https://square.site/book/x', bookingChoice: 'own' });
  });
  it('clearing it clears the own link; an unchanged or AI link changes nothing', () => {
    const prev = rec({ bookingUrl: OWN }, { ownBookingUrl: OWN, bookingChoice: 'own' });
    expect(syncOwnLink(prev, { ...prev, data: { ...prev.data, bookingUrl: '' } }).inputs.ownBookingUrl).toBeUndefined();
    expect(syncOwnLink(prev, prev)).toBe(prev);
    const ai = { ...prev, data: { ...prev.data, bookingUrl: AI } };
    expect(syncOwnLink(prev, ai)).toBe(ai);
  });
});

describe('resolveLinks (publish decides the links)', () => {
  const inp = { ownBookingUrl: OWN, bookingChoice: 'aibarber' as const };
  it('aibarber + bookings + shop -> the AI Barber link', () => {
    expect(resolveLinks(rec().data, inp, ctx({ e: { bookings: true } })).bookingUrl).toBe(AI);
  });
  it('after a downgrade it falls back to the own link, not no button', () => {
    expect(resolveLinks(rec({ bookingUrl: AI }).data, inp, ctx()).bookingUrl).toBe(OWN);
  });
  it('no shop falls back to own; no own link means no button', () => {
    expect(resolveLinks(rec().data, inp, ctx({ e: { bookings: true }, shop: null })).bookingUrl).toBe(OWN);
    expect(resolveLinks(rec({ bookingUrl: AI }).data, { bookingChoice: 'aibarber' }, ctx()).bookingUrl).toBeUndefined();
  });
  it('choice own keeps the own link even with bookings', () => {
    expect(resolveLinks(rec().data, { ...inp, bookingChoice: 'own' }, ctx({ e: { bookings: true } })).bookingUrl).toBe(OWN);
  });
  it('re-adds the AI link even when the server copy lacked it', () => {
    const fromServer = rec({ shopName: 'Fade' }).data; // restored without any link
    expect(resolveLinks(fromServer, { bookingChoice: 'aibarber' }, ctx({ e: { bookings: true } })).bookingUrl).toBe(AI);
  });
  it('shopUrl is added only with store + open + linked shop, else removed', () => {
    const full = ctx({ e: { bookings: true, store: true } });
    expect(resolveLinks(rec().data, inp, full).shopUrl).toBe('https://www.aibarber.org/shop/fade-lab');
    expect(resolveLinks(rec().data, inp, { ...full, storeEnabled: false }).shopUrl).toBeUndefined();
    expect(resolveLinks(rec().data, inp, { ...full, shop: { slug: 'fade-lab', purchaseLinked: false } }).shopUrl).toBeUndefined();
    expect(resolveLinks({ ...rec().data, shopUrl: 'x' } as any, inp, ctx({ e: { bookings: true } })).shopUrl).toBeUndefined();
  });
  it('does nothing while entitlements are unknown, and never mutates', () => {
    const d = rec({ bookingUrl: AI }).data;
    expect(resolveLinks(d, inp, { ...ctx(), ents: { ...ents(), known: false } })).toBe(d);
    const copy = JSON.stringify(d);
    resolveLinks(d, inp, ctx());
    expect(JSON.stringify(d)).toBe(copy);
  });
});
