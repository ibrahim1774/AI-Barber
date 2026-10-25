import { bookingPrefs, bookTargetStatus, resolveLinks, schedulerLive, setOwnLink, syncOwnLink, withChoice, type LinkContext } from '@/lib/bookingChoice';

const OWN = 'https://booksy.com/en-us/1_fade-lab';
const NEW = 'https://square.site/book/new';
const rec = (data: Record<string, unknown> = {}, inputs: Record<string, unknown> = {}): any => ({
  draftId: 'd', inputs: { shopName: 'Fade', area: '', phone: '', ...inputs }, data: { shopName: 'Fade', phone: '1', ...data },
  updatedAt: 1, slug: null, deployedUrl: null, transactionId: null,
});
const ents = (o: Record<string, boolean> = {}) => ({ known: true, hosting: true, bookings: true, store: false, ...o });
const shopOk = { slug: 's', purchaseLinked: true, bookingsEnabled: true };
const ctx = (e: Record<string, boolean> = {}, shop: any = shopOk): LinkContext => ({ ents: ents(e), shop, storeEnabled: false });

describe('default rule is unchanged', () => {
  it('an own link and no explicit choice resolves to the own link', () => {
    const r = rec({ bookingUrl: OWN });
    expect(bookingPrefs(r)).toEqual({ own: OWN, choice: 'own' });
    expect(resolveLinks(r.data, r.inputs, ctx()).bookingUrl).toBe(OWN);
  });
  it('no own link resolves to the scheduler', () => {
    expect(bookingPrefs(rec()).choice).toBe('aibarber');
  });
});

describe('setOwnLink', () => {
  it('stores the link, clears the cleared flag, leaves the choice alone', () => {
    const r = setOwnLink(rec({ bookingUrl: '/book' }, { bookingChoice: 'aibarber', ownBookingCleared: true }), NEW);
    expect(r.inputs.ownBookingUrl).toBe(NEW);
    expect(r.inputs.ownBookingCleared).toBeUndefined();
    expect(r.inputs.bookingChoice).toBe('aibarber');
    expect(r.data.bookingUrl).toBe('/book');
  });
  it('when the choice is own it also sets the data link', () => {
    const r = setOwnLink(rec({ bookingUrl: OWN }, { bookingChoice: 'own', ownBookingUrl: OWN }), NEW);
    expect(r.data.bookingUrl).toBe(NEW);
  });
  it('null clears it on purpose', () => {
    const r = setOwnLink(rec({ bookingUrl: OWN }, { bookingChoice: 'own', ownBookingUrl: OWN }), null);
    expect(r.inputs.ownBookingUrl).toBeUndefined();
    expect(r.inputs.ownBookingCleared).toBe(true);
    expect(r.data.bookingUrl).toBeUndefined();
  });
  it('survives commitRecord: syncOwnLink(cur, withChoice(setOwnLink(cur, u), choice))', () => {
    const cur = rec({ bookingUrl: OWN }, { bookingChoice: 'own', ownBookingUrl: OWN });
    const sched = syncOwnLink(cur, withChoice(setOwnLink(cur, NEW), 'aibarber'));
    expect(sched.inputs.ownBookingUrl).toBe(NEW);
    expect(sched.inputs.bookingChoice).toBe('aibarber');
    expect(sched.data.bookingUrl).toBe('/book');
    const own = syncOwnLink(sched, withChoice(setOwnLink(sched, NEW), 'own'));
    expect(own.inputs.ownBookingUrl).toBe(NEW);
    expect(own.inputs.bookingChoice).toBe('own');
    expect(own.data.bookingUrl).toBe(NEW);
  });
  it('a new link while the scheduler is chosen does not flip the choice', () => {
    const cur = rec({ bookingUrl: '/book' }, { bookingChoice: 'aibarber', ownBookingUrl: OWN });
    const next = syncOwnLink(cur, withChoice(setOwnLink(cur, NEW), 'aibarber'));
    expect(next.inputs).toMatchObject({ bookingChoice: 'aibarber', ownBookingUrl: NEW });
  });
});

describe('scheduler vs link in resolveLinks and bookTargetStatus', () => {
  const cases: [string, Record<string, boolean>, any, boolean][] = [
    ['all true', {}, shopOk, true],
    ['no plan', { bookings: false }, shopOk, false],
    ['bookings off', {}, { ...shopOk, bookingsEnabled: false }, false],
    ['not linked', {}, { ...shopOk, purchaseLinked: false }, false],
    ['no shop', {}, null, false],
  ];
  it.each(cases)('%s', (_n, e, shop, live) => {
    const c = ctx(e, shop);
    expect(schedulerLive(c)).toBe(live);
    for (const own of [OWN, null]) {
      const r = rec({}, { bookingChoice: 'aibarber', ...(own ? { ownBookingUrl: own } : {}) });
      const out = resolveLinks(r.data, r.inputs, c).bookingUrl;
      expect(out).toBe(live ? '/book' : own ?? undefined);
      expect(bookTargetStatus(c, own).status === 'live').toBe(live);
      expect(bookTargetStatus(c, own).fallback).toBe(own ? 'link' : 'none');
    }
  });
  it('names the cause', () => {
    expect(bookTargetStatus(ctx({ bookings: false }), null).status).toBe('no-plan');
    expect(bookTargetStatus(ctx({}, { ...shopOk, purchaseLinked: false }), null).status).toBe('not-linked');
    expect(bookTargetStatus(ctx({}, { ...shopOk, bookingsEnabled: false }), null).status).toBe('bookings-off');
    expect(bookTargetStatus(null, null).status).toBe('unknown');
    expect(bookTargetStatus({ ...ctx(), ents: { ...ents(), known: false } }, null).status).toBe('unknown');
  });
});
