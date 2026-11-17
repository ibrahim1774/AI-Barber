// Native account publish (lane C2 item 4): for a native caller in `account` mode the SERVER decides the Book and Shop links and refreshes the
// team cards, instead of taking them from the phone. Browser publishes keep taking them from siteData (unchanged).
//
// LINKS: a port of the app's linksToSend -> resolveLinks -> stripLapsedLinks (~/abi-next/src/lib/bookingChoice.ts 122-198, src/lib/tierLinks.ts 13-31),
// over what the server knows (plan, shop, store switch) instead of the phone's entitlements and shop context.
//   - Choice inputs (bookingChoice.ts bookingPrefs 36-45): the 1.2 app sends `bookingChoice` ('own' | 'aibarber' | 'call', the app's BookingChoice type, line 16)
//     and `ownBookingUrl` in the drafted publish body. Both are validated here (fixed list; http(s) only, at most 2048 characters, no spaces, not an
//     aibarber.org or primebarber.org host). With them: own = the stored own link, else a non-AI-Barber link in the draft (deriveOwn 31-36);
//     choice = the sent one, else the app's default (an AI Barber link in the draft means aibarber, an own link means own, else aibarber); 'call' keeps
//     no Book button; a choice other than call with no own link is aibarber (bookingPrefs 44).
//   - With NEITHER field sent (a client that does not know them): today's derive-from-draft behaviour: no Book link in the draft = no button, the built-in
//     /book = aibarber, anything else = the own link.
//   - resolveLinks (172-190): Book = none for call; for aibarber the site's /book ONLY when schedulerLive (bookings plan, a shop, the shop's bookings switch;
//     the app also needs a linked Apple purchase, which a web account never has, so the plan gate stands in); otherwise the own link, else none. Shop =
//     '/shop' only with the store plan, a shop, and ab_shops.store_enabled (the app's storeEnabled, src/lib/store/data.ts loadStoreSettings).
//   - stripLapsedLinks: an AI Barber Book link with no bookings plan falls back to the own link, else goes; a Shop link with no store plan goes.
//   - A plan that is not active (no hosting) is the app's not-confirmable branch (linksToSend 194-205): the built-in Book link falls back to the own link
//     (else none) and the Shop link is dropped. The plan lookup failing throws: the caller answers 503.
//
// TEAM: the app's siteEntryFor / refreshStaff (src/lib/team.ts 144-163, 180-200): entries with a memberId take the ACTIVE member's name, photo, bio, title
// (as role) and booking link (the last two only when migration 015 is live: the app's memberProfileLive, ab_members.title/booking_url readable),
// serviceIds (none = every service), up to three serviceNames from the shop's active services, and weekly hours. A removed or inactive member drops
// its card; entries without a memberId are never touched; nothing is ever added. No shop row: the list is left alone (undefined).
import type { TeamMember, WeeklyHours } from '../../types.js';
import { isAiBarberBookingLink } from '../ios/tiers.js';
import { sbRest } from '../webApp/webAppServer.js';

export type BookingChoice = 'own' | 'aibarber' | 'call';
export const BOOKING_CHOICES: readonly BookingChoice[] = ['own', 'aibarber', 'call'];
export interface BookingInputs { bookingChoice?: BookingChoice; ownBookingUrl?: string }

/**
 * An AI Barber booking link as the app's isAiBarberBookingUrl (src/lib/shop.ts 101-105, web build: BRAND_HOSTS = aibarber or primebarber, any subdomain, at
 * /book) plus the server's own recogniser (lib/ios/tiers.ts, which also knows the site's relative /book and the configured preview base).
 * Separate from the server's function on purpose: that one also decides browser publishes, and must not change for them.
 */
const APP_BOOKING = /^(https?:\/\/)?([a-z0-9-]+\.)*(?:aibarber|primebarber)\.org\/book(?=[/?#]|$)/i;
export const isAiBarberBook = (url: unknown): boolean => typeof url === 'string' && (APP_BOOKING.test(url.trim()) || isAiBarberBookingLink(url));

/** Validated booking inputs from a publish body. THROWS {status:400} on an invalid value; absent fields give an empty object. */
export function bookingInputsFrom(body: unknown): BookingInputs {
  const o = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const out: BookingInputs = {};
  if (o.bookingChoice !== undefined && o.bookingChoice !== null) {
    if (typeof o.bookingChoice !== 'string' || !BOOKING_CHOICES.includes(o.bookingChoice as BookingChoice)) throw Object.assign(new Error('invalid_booking_fields'), { status: 400 });
    out.bookingChoice = o.bookingChoice as BookingChoice;
  }
  if (o.ownBookingUrl !== undefined && o.ownBookingUrl !== null && o.ownBookingUrl !== '') {
    const u = typeof o.ownBookingUrl === 'string' ? o.ownBookingUrl.trim() : '';
    let host = '';
    try { host = new URL(u).hostname.toLowerCase().replace(/\.$/, ''); } catch { /* invalid below */ }
    if (!u || u.length > 2048 || /\s/.test(u) || !/^https?:\/\//i.test(u) || !host || /(^|\.)(aibarber|primebarber)\.org$/.test(host) || isAiBarberBook(u)) {
      throw Object.assign(new Error('invalid_booking_fields'), { status: 400 });
    }
    out.ownBookingUrl = u;
  }
  return out;
}

export interface LinkFacts {
  /** Hosting is active (the app's ents.hosting): false = the not-confirmable branch. */
  hosting: boolean;
  bookings: boolean;
  store: boolean;
  shop: { bookingsEnabled: boolean; storeEnabled: boolean } | null;
}

const ownLinkOf = (u?: string | null): string | null => { const t = u?.trim(); return t && !isAiBarberBook(t) ? t : null; };

/** The Book and Shop links a native account publish sends. */
export function linksForNative(data: { bookingUrl?: unknown; shopUrl?: unknown }, f: LinkFacts, inputs: BookingInputs = {}): { bookingUrl?: string; shopUrl?: string } {
  const draftBook = typeof data.bookingUrl === 'string' ? data.bookingUrl.trim() : '';
  const sent = inputs.bookingChoice !== undefined || inputs.ownBookingUrl !== undefined;
  let own: string | null;
  let choice: BookingChoice;
  if (sent) {
    own = inputs.ownBookingUrl ?? ownLinkOf(draftBook); // deriveOwn
    const c: BookingChoice = inputs.bookingChoice ?? (isAiBarberBook(draftBook) ? 'aibarber' : own ? 'own' : 'aibarber'); // bookingPrefs default
    choice = c === 'call' ? 'call' : own ? c : 'aibarber';
  } else {
    own = ownLinkOf(draftBook);
    choice = !draftBook ? 'call' : isAiBarberBook(draftBook) ? 'aibarber' : 'own';
  }
  const schedulerLive = f.bookings && !!f.shop && f.shop.bookingsEnabled;
  let book: string | null;
  let shop: string | null = null;
  if (!f.hosting) {
    // Not confirmable: the built-in link is dropped to the own link, the Shop link is dropped.
    book = choice === 'call' ? null : choice === 'aibarber' ? own : own;
  } else {
    book = choice === 'call' ? null : choice === 'aibarber' && schedulerLive ? '/book' : own; // resolveLinks
    if (f.store && f.shop && f.shop.storeEnabled) shop = '/shop';
    if (!f.bookings && book && isAiBarberBook(book)) book = own; // stripLapsedLinks
  }
  return { ...(book ? { bookingUrl: book } : {}), ...(shop ? { shopUrl: shop } : {}) };
}

export interface MemberFact {
  id: string; display_name: string; photo_url: string | null; bio: string | null; active: boolean;
  /** ab_members.title / booking_url: only read when migration 015 is live. */
  title?: string | null; booking_url?: string | null;
  /** ab_service_members rows: null = every service. */
  serviceIds: string[] | null;
  weeks: { weekday: number; start_min: number; end_min: number }[];
}
export interface ServiceFact { id: string; name: string }

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export function minutesLabel(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
/** Seven rows, Monday first; weekday 0 = Monday; no availability row = closed. A member with no rows at all gets the app's default week (Mon to Sat 9 to 5). */
export function weeklyHoursOf(rows: MemberFact['weeks']): WeeklyHours {
  const week = rows.length ? rows : [0, 1, 2, 3, 4, 5].map((weekday) => ({ weekday, start_min: 540, end_min: 1020 }));
  return DAYS.map((day, i) => {
    const r = week.find((x) => x.weekday === i);
    return r ? { day, open: minutesLabel(r.start_min), close: minutesLabel(r.end_min) } : { day, open: '', close: '', closed: true };
  });
}
/** src/lib/team.ts cleanBookingUrl 113-117. */
const cleanBookingUrl = (v: string | null | undefined): string | undefined => { const t = (v ?? '').trim(); return t && t.length <= 2048 && /^https?:\/\/[^\s]+$/i.test(t) ? t : undefined; };

/** The staff list with ab_members applied; undefined when nothing needs refreshing (the draft's own list is then used). */
export function refreshStaffFromMembers(staff: unknown, members: MemberFact[], services: ServiceFact[], profileLive: boolean): TeamMember[] | undefined {
  if (!Array.isArray(staff) || !staff.some((s) => s && typeof s === 'object' && (s as TeamMember).memberId)) return undefined;
  const byId = new Map(members.map((m) => [m.id, m]));
  const out: TeamMember[] = [];
  for (const s of staff as TeamMember[]) {
    if (!s?.memberId) { out.push(s); continue; }
    const m = byId.get(s.memberId);
    if (!m || !m.active) continue;
    const next: TeamMember = { ...s, name: m.display_name, memberId: m.id };
    const set = <K extends 'role' | 'photo' | 'bio' | 'bookingUrl'>(k: K, val: string | null | undefined) => { if (val) next[k] = val as never; else delete next[k]; };
    set('photo', m.photo_url ?? undefined);
    set('bio', m.bio || undefined);
    if (profileLive) { set('role', m.title ?? undefined); set('bookingUrl', cleanBookingUrl(m.booking_url)); }
    const offered = m.serviceIds ? services.filter((x) => m.serviceIds!.includes(x.id)) : services;
    if (m.serviceIds) next.serviceIds = [...m.serviceIds]; else delete next.serviceIds;
    const names = offered.map((x) => x.name).filter(Boolean).slice(0, 3);
    if (names.length) next.serviceNames = names; else delete next.serviceNames;
    next.hours = weeklyHoursOf(m.weeks);
    out.push(next);
  }
  return out;
}

export interface NativeFactsDeps {
  /** The plan's grants for the account (throws when it cannot be decided). */
  plan(uid: string): Promise<{ hosting: boolean; bookings: boolean; store: boolean }>;
  shop(uid: string): Promise<{ id: string; bookingsEnabled: boolean; storeEnabled: boolean } | null>;
  /** Migration 015 live (ab_members.title and booking_url readable): the app's memberProfileLive. */
  profileLive(): Promise<boolean>;
  members(shopId: string, profileLive: boolean): Promise<MemberFact[]>;
  services(shopId: string): Promise<ServiceFact[]>;
}

/** What the drafted publish passes to prepareIntent as the publication. THROWS on any lookup failure (the caller answers 503). */
export async function nativePublication(uid: string, draft: { bookingUrl?: unknown; shopUrl?: unknown; staff?: unknown }, inputs: BookingInputs = {}, deps: NativeFactsDeps = liveNativeFactsDeps()) {
  const [plan, shop] = await Promise.all([deps.plan(uid), deps.shop(uid)]);
  const links = linksForNative(draft, { hosting: plan.hosting, bookings: plan.bookings, store: plan.store, shop: shop ? { bookingsEnabled: shop.bookingsEnabled, storeEnabled: shop.storeEnabled } : null }, inputs);
  const needsTeam = Array.isArray(draft.staff) && (draft.staff as TeamMember[]).some((s) => s?.memberId);
  let staff: TeamMember[] | undefined;
  if (needsTeam && shop) {
    const profileLive = await deps.profileLive();
    const [members, services] = await Promise.all([deps.members(shop.id, profileLive), deps.services(shop.id)]);
    staff = refreshStaffFromMembers(draft.staff, members, services, profileLive);
  } // no shop row: the draft's own list stays (never drop every card on a guess)
  return { ...links, ...(staff ? { staff } : {}) };
}

const enc = encodeURIComponent;
export function liveNativeFactsDeps(): NativeFactsDeps {
  const rest = async (path: string): Promise<any[]> => (((await sbRest(path)) ?? []) as any[]);
  return {
    async plan(uid) {
      const { accountPlan, defaultKindEnv } = await import('./plan.js');
      const p = await accountPlan(uid, defaultKindEnv());
      const live = p.active && (p.tier === 'bookings' || p.tier === 'store' || p.tier === 'website');
      return { hosting: live, bookings: live && (p.tier === 'bookings' || p.tier === 'store'), store: live && p.tier === 'store' };
    },
    async shop(uid) {
      const r = (await rest(`ab_shops?owner_id=eq.${enc(uid)}&select=id,bookings_enabled,store_enabled&limit=1`))[0];
      return r ? { id: r.id, bookingsEnabled: !!r.bookings_enabled, storeEnabled: !!r.store_enabled } : null;
    },
    async profileLive() {
      try { await rest('ab_members?select=title,booking_url&limit=1'); return true; } catch (e: any) { if (e?.status === 400 || e?.status === 404) return false; throw e; }
    },
    async members(shopId, profileLive) {
      const cols = `id,display_name,photo_url,bio,active${profileLive ? ',title,booking_url' : ''}`;
      const ms = await rest(`ab_members?shop_id=eq.${enc(shopId)}&active=eq.true&select=${cols}&limit=200`);
      if (!ms.length) return [];
      const ids = ms.map((m) => enc(m.id)).join(',');
      const [av, sm] = await Promise.all([
        rest(`ab_availability?member_id=in.(${ids})&select=member_id,weekday,start_min,end_min&limit=2000`),
        rest(`ab_service_members?member_id=in.(${ids})&select=member_id,service_id&limit=5000`),
      ]);
      return ms.map((m) => {
        const sids = sm.filter((x) => x.member_id === m.id).map((x) => x.service_id as string);
        return {
          id: m.id, display_name: m.display_name, photo_url: m.photo_url ?? null, bio: m.bio ?? null, active: !!m.active, title: m.title ?? null, booking_url: m.booking_url ?? null,
          serviceIds: sids.length ? sids : null, weeks: av.filter((a) => a.member_id === m.id).map((a) => ({ weekday: a.weekday, start_min: a.start_min, end_min: a.end_min })),
        };
      });
    },
    async services(shopId) {
      return (await rest(`ab_services?shop_id=eq.${enc(shopId)}&active=eq.true&order=sort.asc&select=id,name&limit=500`)).map((s) => ({ id: s.id, name: s.name }));
    },
  };
}
