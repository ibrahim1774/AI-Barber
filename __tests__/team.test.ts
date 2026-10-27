// P2 app half: the one save used by Setup > Barbers and the Team screen, the site refresh, delete rules, limits.
import type { WebsiteData } from '@/web/types';

let mockSite: { data: WebsiteData } | null;
jest.mock('@/lib/setup/siteSync', () => ({
  updateSiteData: jest.fn(async (change: (d: WebsiteData) => WebsiteData) => {
    if (!mockSite) return null;
    mockSite = { data: change(mockSite.data) };
    return mockSite;
  }),
}));
const mockCall = jest.fn();
jest.mock('@/lib/setup/ownerApi', () => {
  const real = jest.requireActual('@/lib/setup/ownerApi');
  return { ...real, call: (...a: unknown[]) => mockCall(...a) };
});
const mockShop = {
  updateMember: jest.fn(async () => {}),
  saveAvailability: jest.fn(async () => {}),
  setMemberServiceIds: jest.fn(async () => {}),
  listAvailability: jest.fn(async () => []),
  getMemberServiceIds: jest.fn(async () => null),
  listMembers: jest.fn(async () => []),
  listServices: jest.fn(async () => []),
  countUpcoming: jest.fn(async () => 0),
  removeMember: jest.fn(async () => {}),
};
jest.mock('@/lib/shop', () => ({
  ...jest.requireActual('@/lib/shop'),
  ...Object.fromEntries(['updateMember', 'saveAvailability', 'setMemberServiceIds', 'listAvailability', 'getMemberServiceIds', 'listMembers', 'listServices', 'countUpcoming', 'removeMember'].map((k) => [k, (...a: unknown[]) => (mockShop as any)[k](...a)])),
}));
const mockPlan = { shared: null as unknown, getPlan: jest.fn() };
jest.mock('@/lib/plan', () => ({
  ...jest.requireActual('@/lib/plan'),
  getSharedPlan: () => mockPlan.shared,
  getPlan: (...a: unknown[]) => mockPlan.getPlan(...a),
  setSharedPlan: (p: unknown) => { mockPlan.shared = p; },
}));

import { OwnerApiError } from '@/lib/setup/ownerApi';
import { defaultWeek } from '@/lib/setup/availability';
import { teamOf } from '@/web/lib/render/honest';
import type { Service, Shop } from '@/lib/shop';
import {
  addLegacyToBookings, capForTier, limitBeforeAdd, limitOutcome, memberProfileLive, refreshStaff, refreshTeamData,
  removeTeamMember, saveTeamMember, upsertSiteMember, weekToWeeklyHours, type MemberDraft, type MemberView,
} from '@/lib/team';

const UUID = '3f2b8a52-6c1d-4e1f-9a57-0c9d1d2e3f40';
const SHOP = { id: 'shop-1' } as Shop;
const svc = (id: string, name: string) => ({ id, name } as Service);
const SERVICES = [svc('s1', 'Fade'), svc('s2', 'Beard'), svc('s3', 'Shave'), svc('s4', 'Kids')];
const base = (staff?: WebsiteData['staff']): WebsiteData => ({ shopName: 'Jack', staff } as WebsiteData);
const draft = (o: Partial<MemberDraft> = {}): MemberDraft => ({
  name: 'Sam Fade', title: 'Master barber', photo: 'https://img.test/sam.jpg', bio: 'Fades since 2009.',
  bookingUrl: 'https://booksy.com/sam', serviceIds: ['s1', 's2'], week: defaultWeek(), ...o,
});
const apiMember = (id = UUID, o: object = {}) => ({
  member: { id, name: 'Sam Fade', title: null, photo: 'https://img.test/sam.jpg', bio: 'Fades since 2009.', bookingUrl: null, role: 'barber', sort: 10, active: true, ...o },
  limit: 2,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockSite = { data: base([]) };
  mockPlan.shared = null;
});

describe('add goes through POST /api/shop/members, never a direct insert', () => {
  it('posts name/photo/bio, withholds title and link before 015, then hours, services and the site entry', async () => {
    mockCall.mockResolvedValueOnce(apiMember());
    const r = await saveTeamMember({ shop: SHOP, profileLive: false, member: null, draft: draft(), services: SERVICES });
    expect(mockCall).toHaveBeenCalledTimes(1);
    expect(mockCall).toHaveBeenCalledWith('POST', '/api/shop/members', { name: 'Sam Fade', photo: 'https://img.test/sam.jpg', bio: 'Fades since 2009.' });
    expect(mockShop.saveAvailability).toHaveBeenCalledWith(UUID, expect.any(Array));
    expect(mockShop.setMemberServiceIds).toHaveBeenCalledWith(UUID, ['s1', 's2']);
    expect(r.member?.id).toBe(UUID);
    // title and the link are site-only until the server reports 015
    expect(mockSite!.data.staff).toEqual([
      expect.objectContaining({ memberId: UUID, name: 'Sam Fade', role: 'Master barber', bookingUrl: 'https://booksy.com/sam', serviceIds: ['s1', 's2'], serviceNames: ['Fade', 'Beard'] }),
    ]);
    expect(mockShop.updateMember).not.toHaveBeenCalled();
  });

  it('sends title and bookingUrl once 015 is live', async () => {
    mockCall.mockResolvedValueOnce(apiMember(UUID, { title: 'Master barber', bookingUrl: 'https://booksy.com/sam' }));
    await saveTeamMember({ shop: SHOP, profileLive: true, member: null, draft: draft(), services: SERVICES });
    expect(mockCall.mock.calls[0][2]).toEqual({ name: 'Sam Fade', title: 'Master barber', photo: 'https://img.test/sam.jpg', bio: 'Fades since 2009.', bookingUrl: 'https://booksy.com/sam' });
  });

  it('a javascript: link is refused before anything is sent', async () => {
    await expect(saveTeamMember({ shop: SHOP, profileLive: true, member: null, draft: draft({ bookingUrl: 'javascript:alert(1)' }), services: [] })).rejects.toThrow(/http/);
    expect(mockCall).not.toHaveBeenCalled();
  });

  it('is idempotent on retry: a failure after the member exists, then a retry with it, adds no second member', async () => {
    mockCall.mockResolvedValueOnce(apiMember());
    mockShop.setMemberServiceIds.mockRejectedValueOnce(new Error('offline'));
    let created: any = null;
    await expect(saveTeamMember({ shop: SHOP, profileLive: false, member: null, draft: draft(), services: SERVICES, onCreated: (m) => { created = m; } })).rejects.toThrow('offline');
    expect(created?.id).toBe(UUID);
    await saveTeamMember({ shop: SHOP, profileLive: false, member: created, draft: draft(), services: SERVICES });
    expect(mockCall).toHaveBeenCalledTimes(1); // still one POST
    expect(mockShop.updateMember).toHaveBeenCalledTimes(1);
    expect(mockSite!.data.staff).toHaveLength(1);
  });
});

describe('edit with a shop: ab_members first, then the site', () => {
  it('writes title and booking_url columns only when 015 is live', async () => {
    const member = { id: UUID, shopId: 'shop-1', role: 'barber', name: 'Sam', photoUrl: null, bio: '', title: null, bookingUrl: null, sort: 1, icsToken: null } as any;
    await saveTeamMember({ shop: SHOP, profileLive: false, member, draft: draft(), services: SERVICES });
    expect(mockShop.updateMember).toHaveBeenLastCalledWith(UUID, { name: 'Sam Fade', bio: 'Fades since 2009.', photoUrl: 'https://img.test/sam.jpg' });
    await saveTeamMember({ shop: SHOP, profileLive: true, member, draft: draft(), services: SERVICES });
    expect(mockShop.updateMember).toHaveBeenLastCalledWith(UUID, { name: 'Sam Fade', bio: 'Fades since 2009.', photoUrl: 'https://img.test/sam.jpg', title: 'Master barber', bookingUrl: 'https://booksy.com/sam' });
  });

  it('keeps website-only fields of the site entry', async () => {
    mockSite = { data: base([{ name: 'Sam', memberId: UUID, id: 'keep-me', hours: [] } as any]) };
    const member = { id: UUID, shopId: 'shop-1', role: 'barber', name: 'Sam', photoUrl: null, bio: '', title: null, bookingUrl: null, sort: 1, icsToken: null } as any;
    await saveTeamMember({ shop: SHOP, profileLive: true, member, draft: draft(), services: SERVICES });
    expect((mockSite!.data.staff as any)[0].id).toBe('keep-me');
    expect(mockSite!.data.staff).toHaveLength(1);
  });

  it('weekly hours land in the site as open/close text with closed days flagged', () => {
    const w = weekToWeeklyHours(defaultWeek());
    expect(w).toHaveLength(7);
    expect(w[0]).toEqual({ day: 'Monday', open: '9:00 AM', close: '5:00 PM' });
    expect(w[6]).toEqual({ day: 'Sunday', open: '', close: '', closed: true });
  });
});

describe('without a shop the barber is website-only', () => {
  it('never calls the endpoint and writes the site entry only', async () => {
    await saveTeamMember({ shop: null, profileLive: false, member: null, draft: draft({ serviceIds: null }), services: [] });
    expect(mockCall).not.toHaveBeenCalled();
    expect(mockShop.saveAvailability).not.toHaveBeenCalled();
    expect(mockSite!.data.staff).toEqual([{ name: 'Sam Fade', role: 'Master barber', photo: 'https://img.test/sam.jpg', bio: 'Fades since 2009.', bookingUrl: 'https://booksy.com/sam' }]);
  });
  it('edits by index without touching the others', async () => {
    mockSite = { data: base([{ name: 'A' }, { name: 'B', role: 'old' }]) };
    await saveTeamMember({ shop: null, profileLive: false, member: null, siteIndex: 1, draft: draft({ name: 'B2', title: '', bio: '', bookingUrl: '' }), services: [] });
    expect(mockSite!.data.staff!.map((s) => s.name)).toEqual(['A', 'B2']);
    expect(mockSite!.data.staff![1].role).toBeUndefined();
  });
});

describe('scraped or legacy staff never create booking members on their own', () => {
  const legacy = { name: 'Booksy Bob', role: 'Barber', photo: 'https://img.test/b.jpg' };
  it('refresh leaves entries without a memberId alone and calls no endpoint', async () => {
    const d = base([legacy, { name: 'Linked', memberId: UUID }]);
    const out = refreshStaff(d, [{ member: { id: UUID, name: 'Linked', photoUrl: null, bio: '', title: null, bookingUrl: null } as any, serviceIds: null, week: defaultWeek() }], SERVICES, true);
    expect(out.staff![0]).toBe(legacy);
    expect(mockCall).not.toHaveBeenCalled();
  });
  it('"Add to bookings" creates the member through the endpoint and promotes that entry in place', async () => {
    mockSite = { data: base([legacy]) };
    mockCall.mockResolvedValueOnce(apiMember(UUID, { name: 'Booksy Bob' }));
    await addLegacyToBookings({ shop: SHOP, profileLive: false, siteIndex: 0, entry: legacy, week: null, services: SERVICES });
    expect(mockCall).toHaveBeenCalledTimes(1);
    expect(mockSite!.data.staff).toHaveLength(1);
    expect(mockSite!.data.staff![0]).toMatchObject({ name: 'Booksy Bob', memberId: UUID, role: 'Barber' });
  });
  it('is limit-checked: a 409 propagates and the legacy entry stays untouched', async () => {
    mockSite = { data: base([legacy]) };
    mockCall.mockRejectedValueOnce(new OwnerApiError(409, 'member-limit', 'x', { error: 'member-limit', limit: 2 }));
    await expect(addLegacyToBookings({ shop: SHOP, profileLive: false, siteIndex: 0, entry: legacy, week: null, services: SERVICES })).rejects.toBeInstanceOf(OwnerApiError);
    expect(mockSite!.data.staff).toEqual([legacy]);
  });
});

describe('refresh from ab_members', () => {
  const view = (id: string, name: string, over: object = {}): MemberView => ({
    member: { id, name, photoUrl: 'https://img.test/p.jpg', bio: 'bio', title: 'Barber', bookingUrl: null, ...over } as any, serviceIds: ['s3'], week: defaultWeek(),
  });
  it('overwrites name/photo/bio/title/services/hours from the member', () => {
    const d = base([{ name: 'Old name', memberId: UUID, role: 'stale', serviceNames: ['x'] } as any]);
    const out = refreshStaff(d, [view(UUID, 'New name')], SERVICES, true);
    expect(out.staff![0]).toMatchObject({ name: 'New name', role: 'Barber', photo: 'https://img.test/p.jpg', bio: 'bio', serviceIds: ['s3'], serviceNames: ['Shave'] });
    expect(out.staff![0].hours).toHaveLength(7);
  });
  it('before 015 keeps the site-only title', () => {
    const d = base([{ name: 'A', memberId: UUID, role: 'Owner & master barber' }]);
    expect(refreshStaff(d, [view(UUID, 'A', { title: null })], SERVICES, false).staff![0].role).toBe('Owner & master barber');
  });
  it('drops the entry of a member that is no longer active (deleted elsewhere)', () => {
    const d = base([{ name: 'Gone', memberId: UUID }, { name: 'Web only' }]);
    expect(refreshStaff(d, [], SERVICES, true).staff!.map((s) => s.name)).toEqual(['Web only']);
  });
  it('a failed lookup removes nothing', async () => {
    mockShop.listMembers.mockRejectedValueOnce(new Error('offline'));
    mockPlan.shared = { capabilities: { memberProfile: true } };
    const d = base([{ name: 'A', memberId: UUID }]);
    expect(await refreshTeamData(SHOP, d)).toBe(d);
  });
  it('is a no-op (same object) when nothing changed or no shop', async () => {
    const d = base([{ name: 'A' }]);
    expect(await refreshTeamData(null, d)).toBe(d);
    expect(refreshStaff(d, [], SERVICES, true)).toBe(d);
  });
  it('stored staff longer than 5 is not cut by refresh or upsert', () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ name: `B${i}` }));
    const d = upsertSiteMember(base(many), { name: 'New', memberId: UUID });
    expect(d.staff).toHaveLength(9);
    expect(teamOf(d)).toHaveLength(5); // the renderer shows at most 5; the array keeps all
  });
});

describe('delete', () => {
  const member = { id: UUID, shopId: 'shop-1', role: 'barber', name: 'Sam' } as any;
  it('with future appointments changes nothing and reports the count', async () => {
    mockShop.countUpcoming.mockResolvedValueOnce(3);
    mockSite = { data: base([{ name: 'Sam', memberId: UUID }]) };
    expect(await removeTeamMember({ shop: SHOP, member })).toEqual({ kind: 'has-bookings', count: 3 });
    expect(mockShop.removeMember).not.toHaveBeenCalled();
    expect(mockSite!.data.staff).toHaveLength(1);
  });
  it('otherwise deactivates the member and removes the site entry', async () => {
    mockSite = { data: base([{ name: 'Sam', memberId: UUID }, { name: 'Other' }]) };
    expect(await removeTeamMember({ shop: SHOP, member })).toEqual({ kind: 'removed' });
    expect(mockShop.removeMember).toHaveBeenCalledWith(UUID);
    expect(mockSite!.data.staff!.map((s) => s.name)).toEqual(['Other']);
  });
  it('website-only: removes the entry by index', async () => {
    mockSite = { data: base([{ name: 'A' }, { name: 'B' }]) };
    await removeTeamMember({ shop: null, member: null, siteIndex: 0 });
    expect(mockSite!.data.staff!.map((s) => s.name)).toEqual(['B']);
  });
});

describe('limits', () => {
  const err = (status: number, code: string, body: object = {}) => new OwnerApiError(status, code, 'm', { error: code, ...body });
  it('409 on a Bookings shop opens the store_upgrade paywall; at the Store cap it is "at 5"', () => {
    expect(limitOutcome(err(409, 'member-limit', { limit: 2 }))).toEqual({ kind: 'upgrade', limit: 2 });
    expect(limitOutcome(err(409, 'member-limit', { limit: 5 }))).toEqual({ kind: 'at-cap', limit: 5 });
    expect(limitOutcome(err(409, 'member-limit'))).toEqual({ kind: 'upgrade', limit: 2 });
  });
  it('403 members-need-bookings and 503 members-unavailable have their own notices; others are not limits', () => {
    expect(limitOutcome(err(403, 'members-need-bookings'))).toEqual({ kind: 'need-bookings' });
    expect(limitOutcome(err(503, 'members-unavailable'))).toEqual({ kind: 'unavailable' });
    expect(limitOutcome(err(500, 'boom'))).toBeNull();
    expect(limitOutcome(new Error('x'))).toBeNull();
  });
  it('the pre-check uses the plan tier and the members shown (2 on Bookings, 5 on Store); unknown tier proceeds', () => {
    expect(capForTier('bookings')).toBe(2);
    expect(capForTier('store')).toBe(5);
    expect(capForTier('website')).toBeNull();
    expect(limitBeforeAdd('bookings', 1)).toBeNull();
    expect(limitBeforeAdd('bookings', 2)).toEqual({ kind: 'upgrade', limit: 2 });
    expect(limitBeforeAdd('bookings', 4)).toEqual({ kind: 'upgrade', limit: 2 }); // over the limit: still shown, adding opens the paywall
    expect(limitBeforeAdd('store', 5)).toEqual({ kind: 'at-cap', limit: 5 });
    expect(limitBeforeAdd(null, 9)).toBeNull();
  });
  it('a limit error leaves no member, no site entry and no hours behind', async () => {
    mockCall.mockRejectedValueOnce(err(409, 'member-limit', { limit: 2 }));
    await expect(saveTeamMember({ shop: SHOP, profileLive: true, member: null, draft: draft(), services: SERVICES })).rejects.toBeInstanceOf(OwnerApiError);
    expect(mockShop.saveAvailability).not.toHaveBeenCalled();
    expect(mockSite!.data.staff).toEqual([]);
  });
  it('capability flag: shared plan wins; otherwise fetched; a failed fetch means not live', async () => {
    mockPlan.shared = { capabilities: { memberProfile: true } };
    expect(await memberProfileLive()).toBe(true);
    mockPlan.shared = null;
    mockPlan.getPlan.mockResolvedValueOnce({ capabilities: { memberProfile: true } });
    expect(await memberProfileLive()).toBe(true);
    mockPlan.shared = null;
    mockPlan.getPlan.mockRejectedValueOnce(new Error('x'));
    expect(await memberProfileLive()).toBe(false);
  });
});

describe('new barber hours', () => {
  it('copy-from-shop: a new barber without a chosen week gets the owner\'s hours, not a hard-coded default', async () => {
    mockShop.listMembers.mockResolvedValueOnce([{ id: 'own', role: 'owner' }] as any);
    mockShop.listAvailability.mockResolvedValueOnce([{ weekday: 0, startMin: 600, endMin: 900, breakStartMin: null, breakEndMin: null }] as any);
    mockCall.mockResolvedValueOnce(apiMember());
    await saveTeamMember({ shop: SHOP, profileLive: false, member: null, draft: draft({ week: null }), services: SERVICES });
    expect(mockShop.saveAvailability).toHaveBeenCalledWith(UUID, [{ weekday: 0, startMin: 600, endMin: 900, breakStartMin: null, breakEndMin: null }]);
    expect((mockSite!.data.staff as any)[0].hours[0]).toEqual({ day: 'Monday', open: '10:00 AM', close: '3:00 PM' });
  });
});

describe('cards', () => {
  const { teamCards, openDays, daysOfHours } = require('@/lib/team');
  const member = (id: string, name: string, role = 'barber', o: object = {}) => ({ id, name, role, photoUrl: null, bio: '', title: null, bookingUrl: null, sort: 1, icsToken: null, shopId: 's', ...o });
  const view = (m: any, ids: string[] | null = null) => ({ member: m, serviceIds: ids, week: defaultWeek() });
  it('shows every member (even over the plan limit) then website-only entries; mini-week is Monday first', () => {
    const views = [view(member('a', 'Jack', 'owner')), view(member('b', 'Sam'), ['s1', 's2', 's3', 's4']), view(member('c', 'Ali'))];
    const cards = teamCards(views, [{ name: 'Booksy Bob', role: 'Barber' }], SERVICES, true);
    expect(cards.map((c: any) => c.name)).toEqual(['Jack', 'Sam', 'Ali', 'Booksy Bob']);
    expect(cards[0].title).toBe('Owner');
    expect(cards[1].days).toEqual([true, true, true, true, true, true, false]); // default week: Mon-Sat
    expect(cards[1].chips).toEqual(['Fade', 'Beard', 'Shave']);
    expect(cards[1].more).toBe(1);
    expect(cards[2].chips).toEqual(['All services']);
    expect(cards[3]).toMatchObject({ kind: 'site', siteIndex: 0, view: null });
  });
  it('without a shop every entry is a website-only card; linked entries are not doubled', () => {
    const cards = teamCards([], [{ name: 'A' }, { name: 'B', memberId: UUID }, { name: '' }], [], false);
    expect(cards.map((c: any) => c.name)).toEqual(['A']);
  });
  it('site hours become the same 7 dots', () => {
    expect(daysOfHours(weekToWeeklyHours(defaultWeek()))).toEqual(openDays(defaultWeek()));
    expect(daysOfHours(undefined)).toEqual([false, false, false, false, false, false, false]);
  });
});
