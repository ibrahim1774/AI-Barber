import type { SiteRecord } from '@/lib/siteStore';
import { existingBookingLink, switchBookButton } from '@/lib/setup/bookingSwitch';
import { draftToPatch, emptyDraft, serviceToDraft } from '@/lib/setup/serviceDraft';
import { buildSetupBody } from '@/lib/setup/ownerApi';
import { bookingUrl, isAiBarberBookingUrl, shopSettingsRow, toShop, type Service } from '@/lib/shop';
import { shareLabel, shareMessage } from '@/lib/share';

describe('shop data layer', () => {
  it('builds the booking URL as a path', () => {
    expect(bookingUrl({ slug: 'fade-lab' })).toBe('https://www.aibarber.org/book/fade-lab');
    expect(isAiBarberBookingUrl('https://www.aibarber.org/book/fade-lab')).toBe(true);
    // The site's own page is an AI Barber booking link too; /books or /book/x is not.
    expect(isAiBarberBookingUrl('/book')).toBe(true);
    expect(isAiBarberBookingUrl('/book?x=1')).toBe(true);
    expect(isAiBarberBookingUrl('/books')).toBe(false);
    expect(isAiBarberBookingUrl('https://booksy.com/x')).toBe(false);
  });
  it('maps a row defensively', () => {
    const s = toShop({ id: '1', slug: 'a', name: 'A', timezone: 'America/Chicago', manual_handles: null, stripe_account_id: 'acct', platform_fee_bps: 200 });
    expect(s).toMatchObject({ id: '1', payInShop: true, manualHandles: {}, stripeConnected: true, stripeChargesEnabled: false, bookingsEnabled: false, leadDays: 30 });
  });
  it('reads the purchase link from ios_otid', () => {
    expect(toShop({ id: '1', ios_otid: '123' }).purchaseLinked).toBe(true);
    expect(toShop({ id: '1', ios_otid: null }).purchaseLinked).toBe(false);
    expect(toShop({ id: '1' }).purchaseLinked).toBe(false);
  });
  it('only ever writes granted ab_shops columns', () => {
    const row = shopSettingsRow({
      bookingsEnabled: true, payInShop: false, manualHandles: { cashapp: '$a' }, leadDays: 7, minNoticeMin: 0, bufferMin: 5,
      cancelCutoffMin: 60, slotStepMin: null, address: 'x', phone: 'y', accent: '#fff', dailySummary: true, name: 'N',
      // @ts-expect-error not part of the settings type
      slug: 'hack', owner_id: 'u', platformFeeBps: 1, stripeChargesEnabled: true,
    });
    expect(Object.keys(row).sort()).toEqual([
      'accent', 'address', 'bookings_enabled', 'buffer_min', 'cancel_cutoff_min', 'daily_summary', 'lead_days',
      'manual_handles', 'min_notice_min', 'name', 'pay_in_shop', 'phone', 'slot_step_min',
    ]);
  });
});

describe('share', () => {
  it('writes the booking message', () => {
    expect(shareMessage('booking', 'Fade Lab', 'https://u')).toBe('Book your next cut at Fade Lab 💈 https://u');
    expect(shareMessage('booking', '', 'https://u').split('https://u')).toHaveLength(2);
    expect(shareLabel('booking')).toBe('Booking link');
  });
});

describe('setup body and Book button', () => {
  const site = {
    draftId: 'd1', slug: null, deployedUrl: null, transactionId: 'tx1', updatedAt: 1,
    inputs: { shopName: 'Fade Lab', area: '', phone: '' },
    data: {
      shopName: 'Fade Lab', phone: '555', bookingUrl: 'https://booksy.com/x', contact: { address: '1 Main St', email: '' },
      services: [{ title: 'Cut', subtitle: '', description: '', icon: 'scissors', imageUrl: '', price: '$30', duration: '30 min' }],
    },
  } as unknown as SiteRecord;

  it('builds /api/shop/setup', () => {
    expect(buildSetupBody(site, 'America/Chicago')).toEqual({
      siteId: 'd1', name: 'Fade Lab', timezone: 'America/Chicago', address: '1 Main St', phone: '555', transactionId: 'tx1',
      services: [{ name: 'Cut', priceCents: 3000, durationMin: 30 }],
    });
  });
  it('detects another calendar and switches only on request', () => {
    expect(existingBookingLink(site.data)).toBe('https://booksy.com/x');
    expect(existingBookingLink({ bookingUrl: 'https://www.aibarber.org/book/a' })).toBeNull();
    expect(site.data.bookingUrl).toBe('https://booksy.com/x');
    expect(switchBookButton(site.data, { slug: 'fade' }).bookingUrl).toBe('/book');
  });
});

describe('service form', () => {
  const base: Service = {
    id: 'i', shopId: 's', name: 'Cut', priceCents: 2550, durationMin: 30, description: '', photoUrl: null,
    bookable: true, showOnSite: true, depositType: 'fixed', depositValue: 1000, sort: 0,
  };
  it('loads and saves a draft', () => {
    const d = serviceToDraft(base);
    expect(d).toMatchObject({ price: '25.50', deposit: '10', depositType: 'fixed' });
    const r = draftToPatch(d);
    expect(r).toEqual({ ok: true, patch: expect.objectContaining({ name: 'Cut', priceCents: 2550, depositType: 'fixed', depositValue: 1000 }) });
  });
  it('validates', () => {
    expect(draftToPatch(emptyDraft('')).ok).toBe(false);
    expect(draftToPatch({ ...emptyDraft('A'), price: 'abc' }).ok).toBe(false);
    expect(draftToPatch({ ...emptyDraft('A'), price: '10', depositType: 'fixed', deposit: '20' }).ok).toBe(false);
    expect(draftToPatch({ ...emptyDraft('A'), depositType: 'percent', deposit: '101' }).ok).toBe(false);
    expect(draftToPatch({ ...emptyDraft('A'), price: '', depositType: 'percent', deposit: '25' })).toEqual({
      ok: true, patch: expect.objectContaining({ priceCents: null, depositValue: 25 }),
    });
  });
});
