import type { TeamMember, WebsiteData, WeeklyHours } from '@/web/types';
import { OwnerApiError, call } from '@/lib/setup/ownerApi';
import { defaultWeek, minutesLabel, rowsToWeek, weekToRows, WEEKDAYS, type DayHours } from '@/lib/setup/availability';
import { getSharedPlan, getPlan, getPlanEpoch, setSharedPlan, type Tier } from '@/lib/plan';
import { updateSiteData } from '@/lib/setup/siteSync';
import {
  countUpcoming, getMemberServiceIds, listAvailability, listMembers, listServices, loadMyShop, removeMember, saveAvailability,
  setMemberServiceIds, toMember, updateMember, type Member, type Service, type Shop,
} from '@/lib/shop';

/**
 * Team profiles (spec 2026-10-23, P2). With a shop, `ab_members` is the source of truth for name, photo, bio,
 * title, booking link, services and hours; the site's `staff[i]` keeps `memberId` plus website-only fields and
 * is refreshed from ab_members (on open, before publish). Without a shop the site JSON is all there is.
 * Setup > Barbers and the Team screen both save through saveTeamMember / removeTeamMember below.
 */

// ---- limits ------------------------------------------------------------------

/** Active members (owner included) a plan allows. Decided by Ibrahim: Bookings 2, Store 5. The server enforces it. */
export const MEMBER_CAP: Record<'bookings' | 'store', number> = { bookings: 2, store: 5 };

export function capForTier(tier: Tier | null | undefined): number | null {
  return tier === 'bookings' || tier === 'store' ? MEMBER_CAP[tier] : null;
}

export type LimitOutcome =
  /** Bookings shop at its limit: open the store_upgrade paywall. */
  | { kind: 'upgrade'; limit: number }
  /** Store shop at its limit: "You're at 5 barbers". */
  | { kind: 'at-cap'; limit: number }
  /** No Bookings/Store plan: explain that barbers are part of the Bookings plan. */
  | { kind: 'need-bookings' }
  /** Migration 015 not applied on the server yet. */
  | { kind: 'unavailable' };

/** What a failed "add a barber" means for the UI; null when it is some other error. */
export function limitOutcome(e: unknown): LimitOutcome | null {
  if (!(e instanceof OwnerApiError)) return null;
  if (e.status === 403 && e.code === 'members-need-bookings') return { kind: 'need-bookings' };
  if (e.status === 503 && e.code === 'members-unavailable') return { kind: 'unavailable' };
  if (e.status === 409 && e.code === 'member-limit') {
    const raw = e.body?.limit;
    const limit = typeof raw === 'number' && raw > 0 ? raw : MEMBER_CAP.bookings;
    return limit >= MEMBER_CAP.store ? { kind: 'at-cap', limit } : { kind: 'upgrade', limit };
  }
  return null;
}

/**
 * Checked before the sheet opens, from what the app already knows (plan tier, members shown). Null = go ahead;
 * the server stays the authority (a stale plan still gets the 409 handled above).
 */
export function limitBeforeAdd(tier: Tier | null | undefined, activeMembers: number): LimitOutcome | null {
  const cap = capForTier(tier);
  if (cap == null || activeMembers < cap) return null;
  return tier === 'store' ? { kind: 'at-cap', limit: cap } : { kind: 'upgrade', limit: cap };
}

export function atCapMessage(limit: number): { title: string; body: string } {
  return { title: `You're at ${limit} barbers`, body: `The Store plan includes up to ${limit} people on your team, you included. Remove a barber to add someone new.` };
}

export const NEED_BOOKINGS_MESSAGE = {
  title: 'Barbers are part of the Bookings plan',
  body: 'With the Bookings plan, customers can book you or one other barber online. The Store plan adds up to five. Your website team cards work on any plan.',
};

// ---- capability flag ---------------------------------------------------------

/** True once the server reports migration 015 live (title / booking_url columns, POST /api/shop/members). */
export async function memberProfileLive(): Promise<boolean> {
  const shared = getSharedPlan();
  if (shared) return shared.capabilities.memberProfile;
  try {
    const epoch = getPlanEpoch();
    const p = await getPlan();
    if (epoch === getPlanEpoch()) setSharedPlan(p);
    return p.capabilities.memberProfile;
  } catch {
    return false;
  }
}

// ---- the add endpoint --------------------------------------------------------

export type NewMemberFields = { name: string; title?: string; photo?: string | null; bio?: string; bookingUrl?: string };

/** POST /api/shop/members: the only way to create a booking member (never a direct insert). */
export async function addMemberViaApi(f: NewMemberFields, profileLive: boolean): Promise<{ member: Member; limit: number }> {
  const body: Record<string, string> = { name: f.name.trim() };
  if (f.photo) body.photo = f.photo;
  if (f.bio?.trim()) body.bio = f.bio.trim();
  // title and booking_url are columns of migration 015; before it they live in the site JSON only.
  if (profileLive) {
    if (f.title?.trim()) body.title = f.title.trim();
    const link = cleanBookingUrl(f.bookingUrl);
    if (link) body.bookingUrl = link;
  }
  const r = await call<{ member: { id: string; name: string; title: string | null; photo: string | null; bio: string | null; bookingUrl: string | null; role: string; sort: number }; limit: number }>(
    'POST', '/api/shop/members', body,
  );
  const m = r.member;
  return {
    limit: r.limit,
    member: toMember({ id: m.id, shop_id: '', role: m.role, display_name: m.name, photo_url: m.photo, bio: m.bio, title: m.title, booking_url: m.bookingUrl, sort: m.sort }),
  };
}

// ---- small helpers -----------------------------------------------------------

/** http(s) links only, trimmed; anything else is dropped (the server and the renderer check again). */
export function cleanBookingUrl(v: string | null | undefined): string | undefined {
  const t = (v ?? '').trim();
  if (!t || t.length > 2048) return undefined;
  return /^https?:\/\/[^\s]+$/i.test(t) ? t : undefined;
}

/** Seven rows for the site: the same shape as the shop's `hours`. Closed days carry empty times. */
export function weekToWeeklyHours(week: DayHours[]): WeeklyHours {
  return week.map((d, i) => (d.open
    ? { day: WEEKDAYS[i], open: minutesLabel(d.startMin), close: minutesLabel(d.endMin) }
    : { day: WEEKDAYS[i], open: '', close: '', closed: true }));
}

/** Which of the seven days (Monday first) a barber works. */
export function openDays(week: DayHours[] | null | undefined): boolean[] {
  return WEEKDAYS.map((_, i) => !!week?.[i]?.open);
}

export const initialOf = (name: string): string => name.trim().charAt(0).toUpperCase() || '?';

// ---- the site side -----------------------------------------------------------

export type MemberView = {
  member: Member;
  /** null = every service */
  serviceIds: string[] | null;
  week: DayHours[];
};

/** The site entry for a member: website-only fields of `prev` survive, everything ab_members owns is overwritten. */
export function siteEntryFor(
  v: MemberView, services: Service[], prev: TeamMember | undefined, profileLive: boolean,
): TeamMember {
  const { member } = v;
  const out: TeamMember = { ...(prev ?? { name: member.name }), name: member.name, memberId: member.id };
  const set = <K extends 'role' | 'photo' | 'bio' | 'bookingUrl'>(k: K, val: string | null | undefined) => {
    if (val) out[k] = val; else delete out[k];
  };
  set('photo', member.photoUrl ?? undefined);
  set('bio', member.bio || undefined);
  // Before 015 the title and the link are only in the site JSON: keep what is there.
  if (profileLive) {
    set('role', member.title ?? undefined);
    set('bookingUrl', cleanBookingUrl(member.bookingUrl));
  }
  const offered = v.serviceIds ? services.filter((s) => v.serviceIds!.includes(s.id)) : services;
  if (v.serviceIds) out.serviceIds = [...v.serviceIds]; else delete out.serviceIds;
  const names = offered.map((s) => s.name).filter(Boolean).slice(0, 3);
  if (names.length) out.serviceNames = names; else delete out.serviceNames;
  out.hours = weekToWeeklyHours(v.week);
  return out;
}

/** Adds the entry, or replaces the one with the same memberId (idempotent on retry). */
export function upsertSiteMember(d: WebsiteData, entry: TeamMember): WebsiteData {
  const staff = d.staff ?? [];
  const at = entry.memberId ? staff.findIndex((s) => s?.memberId === entry.memberId) : -1;
  return { ...d, staff: at >= 0 ? staff.map((s, i) => (i === at ? entry : s)) : [...staff, entry] };
}

export function removeSiteMember(d: WebsiteData, memberId: string): WebsiteData {
  const staff = d.staff ?? [];
  if (!staff.some((s) => s?.memberId === memberId)) return d;
  return { ...d, staff: staff.filter((s) => s?.memberId !== memberId) };
}

/**
 * Refreshes `staff` from ab_members. Entries with a memberId take the member's values; one whose member is no
 * longer active is dropped; entries without a memberId (scraped, legacy, website-only) are never touched and
 * never create a booking member. `live` null (the lookup failed) changes nothing.
 */
export function refreshStaff(
  d: WebsiteData, live: MemberView[] | null, services: Service[], profileLive: boolean,
): WebsiteData {
  if (!live || !Array.isArray(d.staff) || !d.staff.some((s) => s?.memberId)) return d;
  const byId = new Map(live.map((v) => [v.member.id, v]));
  let changed = false;
  const staff: TeamMember[] = [];
  for (const s of d.staff) {
    if (!s?.memberId) { staff.push(s); continue; }
    const v = byId.get(s.memberId);
    if (!v) { changed = true; continue; }
    const next = siteEntryFor(v, services, s, profileLive);
    if (JSON.stringify(next) !== JSON.stringify(s)) changed = true;
    staff.push(next);
  }
  return changed ? { ...d, staff } : d;
}

// ---- reading the live team ---------------------------------------------------

export async function loadMemberViews(shopId: string): Promise<{ views: MemberView[]; services: Service[] }> {
  const [members, services] = await Promise.all([listMembers(shopId), listServices(shopId)]);
  const views = await Promise.all(members.map(async (member) => {
    const [serviceIds, rows] = await Promise.all([
      getMemberServiceIds(member.id).catch(() => null),
      listAvailability(member.id).catch(() => []),
    ]);
    return { member, serviceIds, week: rows.length ? rowsToWeek(rows) : defaultWeek() };
  }));
  return { views, services };
}

/**
 * The site data with `staff` refreshed from ab_members. Never throws: a failed lookup returns `d` untouched
 * (the site keeps what it had, nothing is removed on a guess).
 */
export async function refreshTeamData(shop: Shop | null, d: WebsiteData): Promise<WebsiteData> {
  if (!shop || !d.staff?.some((s) => s?.memberId)) return d;
  try {
    const profileLive = await memberProfileLive();
    const { views, services } = await loadMemberViews(shop.id);
    return refreshStaff(d, views, services, profileLive);
  } catch {
    return d;
  }
}

/**
 * Loads the live team and writes it into the saved site (the Team screen and Barbers on open).
 * Returns what it loaded, or null when the lookup failed (the site is then left as it was).
 */
export async function refreshSavedTeam(shop: Shop | null): Promise<{ views: MemberView[]; services: Service[]; profileLive: boolean } | null> {
  if (!shop) return null;
  try {
    const profileLive = await memberProfileLive();
    const loaded = await loadMemberViews(shop.id);
    await updateSiteData((d) => refreshStaff(d, loaded.views, loaded.services, profileLive));
    return { ...loaded, profileLive };
  } catch {
    return null; // the next open tries again
  }
}

// ---- cards -------------------------------------------------------------------

export type TeamCard = {
  key: string;
  /** member: a booking member. site: a website-only entry (scraped, legacy, or no shop). */
  kind: 'member' | 'site';
  name: string;
  title: string;
  photo: string | null;
  /** Monday first: the 7-dot mini-week */
  days: boolean[];
  /** at most 3 */
  chips: string[];
  more: number;
  isOwner: boolean;
  view: MemberView | null;
  siteIndex: number | null;
  entry: TeamMember | null;
};

const CHIP_MAX = 3;

function chipsOf(names: string[]): { chips: string[]; more: number } {
  return { chips: names.slice(0, CHIP_MAX), more: Math.max(0, names.length - CHIP_MAX) };
}

/** Days a stored WeeklyHours is open (Monday first); all false when none is stored. */
export function daysOfHours(h: WeeklyHours | undefined): boolean[] {
  return WEEKDAYS.map((name) => {
    const row = h?.find((r) => r.day === name);
    return !!row && !row.closed && !!row.open;
  });
}

/**
 * The Team screen's cards: every active member first (all of them, however many the plan allows), then the
 * website-only entries (scraped or legacy staff, or everything when there is no shop).
 */
export function teamCards(views: MemberView[], staff: WebsiteData['staff'], services: Service[], profileLive: boolean): TeamCard[] {
  const list = Array.isArray(staff) ? staff : [];
  const cards: TeamCard[] = views.map((v) => {
    const at = list.findIndex((s) => s?.memberId === v.member.id);
    const entry = at >= 0 ? list[at] : null;
    const names = v.serviceIds ? services.filter((s) => v.serviceIds!.includes(s.id)).map((s) => s.name) : ['All services'];
    const title = (profileLive ? v.member.title : null) ?? entry?.role ?? v.member.title ?? (v.member.role === 'owner' ? 'Owner' : 'Barber');
    return {
      key: v.member.id, kind: 'member', name: v.member.name, title, photo: v.member.photoUrl, days: openDays(v.week),
      ...chipsOf(names), isOwner: v.member.role === 'owner', view: v, siteIndex: at >= 0 ? at : null, entry,
    };
  });
  list.forEach((s, i) => {
    if (!s || s.memberId || !s.name) return;
    cards.push({
      key: `site-${i}`, kind: 'site', name: s.name, title: s.role || 'Team', photo: s.photo && /^https?:\/\//i.test(s.photo) ? s.photo : null,
      days: daysOfHours(s.hours), ...chipsOf(s.serviceNames ?? []), isOwner: false, view: null, siteIndex: i, entry: s,
    });
  });
  return cards;
}

/** The shop's weekly hours (the owner's availability), the default a new barber copies. */
export async function shopWeek(shopId: string): Promise<DayHours[]> {
  try {
    const owner = (await listMembers(shopId)).find((m) => m.role === 'owner');
    const rows = owner ? await listAvailability(owner.id) : [];
    return rows.length ? rowsToWeek(rows) : defaultWeek();
  } catch {
    return defaultWeek();
  }
}

// ---- saving ------------------------------------------------------------------

export type MemberDraft = {
  name: string;
  title: string;
  photo: string | null;
  bio: string;
  bookingUrl: string;
  /** null = every service */
  serviceIds: string[] | null;
  /** null = leave the hours as they are (editing without opening the hours step) */
  week: DayHours[] | null;
};

export type SaveArgs = {
  shop: Shop | null;
  profileLive: boolean;
  /** The booking member being edited (or created by an earlier attempt of this same save). */
  member: Member | null;
  /** Index into site.staff for a website-only barber being edited. */
  siteIndex?: number | null;
  draft: MemberDraft;
  services: Service[];
  /** Called as soon as the member exists, so a retry after a later failure updates instead of adding another. */
  onCreated?(m: Member): void;
};

/**
 * The one save used by Setup > Barbers and the Team screen.
 * - With a shop: ab_members first (new members only through POST /api/shop/members), then services and hours,
 *   then the site's staff entry (memberId + website-only fields, refreshed from what was just saved).
 * - Without a shop: the site entry only.
 */
export async function saveTeamMember(a: SaveArgs): Promise<{ member: Member | null }> {
  const { shop, profileLive, services } = a;
  let draft = a.draft;
  const name = draft.name.trim();
  if (!name) throw new Error('Give this barber a name.');
  const title = draft.title.trim();
  const bio = draft.bio.trim();
  const link = cleanBookingUrl(draft.bookingUrl);
  if (draft.bookingUrl.trim() && !link) throw new Error('The booking link must start with http:// or https://');

  if (!shop) {
    const entry: TeamMember = { name };
    if (title) entry.role = title;
    if (draft.photo) entry.photo = draft.photo;
    if (bio) entry.bio = bio;
    if (link) entry.bookingUrl = link;
    const idx = a.siteIndex;
    await updateSiteData((d) => {
      const staff = d.staff ?? [];
      if (idx == null || idx < 0 || idx >= staff.length) return { ...d, staff: [...staff, entry] };
      return { ...d, staff: staff.map((s, i) => (i === idx ? { ...s, ...entry, role: entry.role, bio: entry.bio, bookingUrl: entry.bookingUrl } : s)) };
    });
    return { member: null };
  }

  let member = a.member;
  if (member) {
    await updateMember(member.id, {
      name, bio, photoUrl: draft.photo,
      ...(profileLive ? { title: title || null, bookingUrl: link ?? null } : {}),
    });
    member = { ...member, name, bio, photoUrl: draft.photo, ...(profileLive ? { title: title || null, bookingUrl: link ?? null } : {}) };
    if (draft.week) await saveAvailability(member.id, weekToRows(draft.week));
  } else {
    const created = await addMemberViaApi({ name, title, photo: draft.photo, bio, bookingUrl: link }, profileLive);
    member = { ...created.member, shopId: shop.id };
    a.onCreated?.(member);
    // A new barber works the hours the sheet showed (copied from the shop unless changed).
    const first = draft.week ?? (await shopWeek(shop.id));
    await saveAvailability(member.id, weekToRows(first));
    draft = { ...draft, week: first };
  }
  await setMemberServiceIds(member.id, draft.serviceIds);

  const week = draft.week ?? (await listAvailability(member.id).then((r) => (r.length ? rowsToWeek(r) : defaultWeek())).catch(() => defaultWeek()));
  const saved = member;
  const view: MemberView = { member: saved, serviceIds: draft.serviceIds, week };
  const slot = a.siteIndex;
  await updateSiteData((d) => {
    const staff = d.staff ?? [];
    // A scraped or legacy entry being promoted ("Add to bookings") takes the member id in place, never doubles.
    const legacy = slot != null && slot >= 0 && slot < staff.length && !staff[slot]?.memberId ? staff[slot] : undefined;
    const prev = staff.find((s) => s?.memberId === saved.id) ?? legacy;
    const entry = siteEntryFor(view, services, prev, profileLive);
    // Before 015 the title and the link are site-only: take them from the draft.
    if (!profileLive) {
      if (title) entry.role = title; else delete entry.role;
      if (link) entry.bookingUrl = link; else delete entry.bookingUrl;
    }
    if (legacy && !staff.some((s) => s?.memberId === saved.id)) return { ...d, staff: staff.map((s, i) => (i === slot ? entry : s)) };
    return upsertSiteMember(d, entry);
  });
  return { member: saved };
}

export type RemoveResult =
  | { kind: 'removed' }
  /** Future appointments: nothing was changed; cancel or move them first. */
  | { kind: 'has-bookings'; count: number };

/** Deactivates the member and removes the site entry. Refuses while the barber has future appointments. */
export async function removeTeamMember(a: { shop: Shop | null; member: Member | null; siteIndex?: number | null }): Promise<RemoveResult> {
  const { member } = a;
  if (a.shop && member) {
    const count = await countUpcoming(member.id);
    if (count > 0) return { kind: 'has-bookings', count };
    await removeMember(member.id);
    await updateSiteData((d) => removeSiteMember(d, member.id));
    return { kind: 'removed' };
  }
  const idx = a.siteIndex;
  if (idx != null) {
    await updateSiteData((d) => ({ ...d, staff: (d.staff ?? []).filter((_, i) => i !== idx) }));
  }
  return { kind: 'removed' };
}

/**
 * The explicit "Add to bookings" action for a scraped, legacy or website-only barber: creates the booking member
 * through the limit-checked endpoint and links the site entry to it. Limit errors propagate (see limitOutcome).
 */
export async function addLegacyToBookings(a: {
  shop: Shop; profileLive: boolean; siteIndex: number; entry: TeamMember; week: DayHours[] | null; services: Service[];
  onCreated?(m: Member): void;
}): Promise<Member> {
  const { entry } = a;
  const r = await saveTeamMember({
    shop: a.shop,
    profileLive: a.profileLive,
    member: null,
    siteIndex: a.siteIndex,
    draft: {
      name: entry.name, title: entry.role ?? '', photo: entry.photo && /^https?:\/\//i.test(entry.photo) ? entry.photo : null,
      bio: entry.bio ?? '', bookingUrl: entry.bookingUrl ?? '', serviceIds: null, week: a.week,
    },
    services: a.services,
    onCreated: a.onCreated,
  });
  return r.member!;
}

/** PublishDeps.refreshTeam: loads the signed-in owner's shop and refreshes `staff` from ab_members. Never throws. */
export async function refreshTeamBeforePublish(d: WebsiteData): Promise<WebsiteData> {
  if (!d.staff?.some((s) => s?.memberId)) return d;
  try {
    return await refreshTeamData(await loadMyShop(), d);
  } catch {
    return d;
  }
}
