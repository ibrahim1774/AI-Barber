// Native account publish (lane C2 item 4): for a native caller in `account` mode the SERVER decides the Book and Shop links and refreshes the
// team cards, instead of taking them from the phone. Browser publishes keep taking them from siteData (unchanged).
// Link rule: a port of the app's linksToSend / resolveLinks (src/lib/bookingChoice.ts), over what the server knows:
//   - the choice is read from the saved draft's own Book link (the phone saves `withChoice` data): none = no Book button ('call'), the
//     built-in /book = AI Barber, anything else = the barber's own link. (The app's `inputs` never reach the server.)
//   - built-in /book only when the plan has bookings AND a shop exists AND its bookings switch is open (schedulerLive). Otherwise the own link,
//     else none. The app also needs a linked Apple purchase there; a web account has none, so the plan gate stands in for it.
//   - /shop only with the store plan and a shop. (The app's storeEnabled flag has no server twin: the store plan is the gate.)
//   - Plan unknown (lookup failed) => the caller answers 503; links are never guessed.
// Team: entries with a memberId take the active member's name, photo and weekly hours from ab_members / ab_availability; a member that is
// removed or inactive drops its card; entries without a memberId are never touched; nothing is ever added.
import { isAiBarberBookingLink } from '../ios/tiers.js';
import type { TeamMember, WeeklyHours } from '../../types.js';

export interface LinkFacts { bookings: boolean; store: boolean; shop: { bookingsEnabled: boolean } | null }
export interface MemberFact { id: string; display_name: string; photo_url: string | null; active: boolean; weeks: { weekday: number; start_min: number; end_min: number }[] }

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

/** The Book and Shop links a native account publish sends. */
export function linksForNative(data: { bookingUrl?: unknown; shopUrl?: unknown }, f: LinkFacts): { bookingUrl?: string; shopUrl?: string } {
  const raw = typeof data.bookingUrl === 'string' ? data.bookingUrl.trim() : '';
  const aiBarber = !!raw && isAiBarberBookingLink(raw);
  const own = raw && !aiBarber ? raw : null;
  const schedulerLive = f.bookings && !!f.shop && f.shop.bookingsEnabled;
  const book = aiBarber ? (schedulerLive ? '/book' : null) : own;
  return { ...(book ? { bookingUrl: book } : {}), ...(f.store && f.shop ? { shopUrl: '/shop' } : {}) };
}

/** The staff list with ab_members applied; returns undefined when nothing needs refreshing (the draft's own list is then used). */
export function refreshStaffFromMembers(staff: unknown, members: MemberFact[]): TeamMember[] | undefined {
  if (!Array.isArray(staff) || !staff.some((s) => s && typeof s === 'object' && (s as TeamMember).memberId)) return undefined;
  const byId = new Map(members.map((m) => [m.id, m]));
  const out: TeamMember[] = [];
  for (const s of staff as TeamMember[]) {
    if (!s?.memberId) { out.push(s); continue; }
    const m = byId.get(s.memberId);
    if (!m || !m.active) continue;
    const next: TeamMember = { ...s, name: m.display_name, hours: weeklyHoursOf(m.weeks) };
    if (m.photo_url) next.photo = m.photo_url; else delete next.photo;
    out.push(next);
  }
  return out;
}

export interface NativeFactsDeps {
  /** The plan's grants for the account: null = could not be decided. */
  plan(uid: string): Promise<{ bookings: boolean; store: boolean }>;
  shop(uid: string): Promise<{ id: string; bookingsEnabled: boolean } | null>;
  members(shopId: string): Promise<MemberFact[]>;
}

/** What the drafted publish passes to prepareIntent as the publication. THROWS on any lookup failure (the caller answers 503). */
export async function nativePublication(uid: string, draft: { bookingUrl?: unknown; shopUrl?: unknown; staff?: unknown }, deps: NativeFactsDeps = liveNativeFactsDeps()) {
  const [plan, shop] = await Promise.all([deps.plan(uid), deps.shop(uid)]);
  const links = linksForNative(draft, { bookings: plan.bookings, store: plan.store, shop: shop ? { bookingsEnabled: shop.bookingsEnabled } : null });
  const needsTeam = Array.isArray(draft.staff) && (draft.staff as TeamMember[]).some((s) => s?.memberId);
  const staff = needsTeam && shop ? refreshStaffFromMembers(draft.staff, await deps.members(shop.id)) : needsTeam ? refreshStaffFromMembers(draft.staff, []) : undefined;
  return { ...links, ...(staff ? { staff } : {}) };
}

const enc = encodeURIComponent;
export function liveNativeFactsDeps(): NativeFactsDeps {
  return {
    async plan(uid) {
      const { accountPlan, defaultKindEnv } = await import('./plan.js');
      const p = await accountPlan(uid, defaultKindEnv());
      const live = p.active && (p.tier === 'bookings' || p.tier === 'store' || p.tier === 'website');
      return { bookings: live && (p.tier === 'bookings' || p.tier === 'store'), store: live && p.tier === 'store' };
    },
    async shop(uid) {
      const { sbRest } = await import('../webApp/webAppServer.js');
      const r = ((await sbRest(`ab_shops?owner_id=eq.${enc(uid)}&select=id,bookings_enabled&limit=1`)) ?? [])[0];
      return r ? { id: r.id, bookingsEnabled: !!r.bookings_enabled } : null;
    },
    async members(shopId) {
      const { sbRest } = await import('../webApp/webAppServer.js');
      const ms = ((await sbRest(`ab_members?shop_id=eq.${enc(shopId)}&select=id,display_name,photo_url,active&limit=200`)) ?? []) as any[];
      if (!ms.length) return [];
      const av = ((await sbRest(`ab_availability?member_id=in.(${ms.map((m) => enc(m.id)).join(',')})&select=member_id,weekday,start_min,end_min&limit=2000`)) ?? []) as any[];
      return ms.map((m) => ({ id: m.id, display_name: m.display_name, photo_url: m.photo_url ?? null, active: !!m.active, weeks: av.filter((a) => a.member_id === m.id).map((a) => ({ weekday: a.weekday, start_min: a.start_min, end_min: a.end_min })) }));
    },
  };
}
