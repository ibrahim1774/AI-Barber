import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { listAppointments, listTimeOff } from '@/lib/bookings/api';
import { addDays, dayRange, todayKey, type Appointment, type DateKey, type TimeOff } from '@/lib/bookings/calendar';
import {
  listAvailability, listMembers, listServices, loadMyShop, type AvailabilityRow, type Member, type Service, type Shop,
} from '@/lib/bookings/shop';

export const DAYS_BACK = 14;
export const DAYS_AHEAD = 60;

export type Phase = 'loading' | 'ready' | 'no-shop' | 'error';

export interface BookingsData {
  phase: Phase;
  shop: Shop | null;
  members: Member[];
  services: Service[];
  appts: Appointment[];
  timeOff: TimeOff[];
  /** Every active barber's weekly hours (empty rows when a read failed). */
  availability: AvailabilityRow[];
  refresh(): Promise<void>;
}

/** Loads the shop, its barbers and services, and the strip's window of bookings; reloads on focus. */
export function useBookingsData(visible?: { from: DateKey; to: DateKey } | null): BookingsData {
  const [phase, setPhase] = useState<Phase>('loading');
  const [shop, setShop] = useState<Shop | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [timeOff, setTimeOff] = useState<TimeOff[]>([]);
  const [availability, setAvailability] = useState<AvailabilityRow[]>([]);
  const seq = useRef(0);
  const loadedRange = useRef<{ lo: DateKey; hi: DateKey } | null>(null);
  // Week / month views widen the window to what they show (+ one unit either side); the strip window stays.
  const want = useRef(visible ?? null);
  want.current = visible ?? null;

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const s = await loadMyShop();
      if (mine !== seq.current) return;
      if (!s) {
        setShop(null);
        setPhase('no-shop');
        return;
      }
      const today = todayKey(s.timezone);
      const w = want.current;
      const lo = w ? [addDays(today, -DAYS_BACK), addDays(w.from, -31)].sort()[0] : addDays(today, -DAYS_BACK);
      const hi = w ? [addDays(today, DAYS_AHEAD + 1), addDays(w.to, 31)].sort().reverse()[0] : addDays(today, DAYS_AHEAD + 1);
      const from = dayRange(lo, s.timezone).start;
      const to = dayRange(hi, s.timezone).start;
      const [m, sv, a] = await Promise.all([listMembers(s.id), listServices(s.id), listAppointments(s.id, from, to)]);
      const activeMembers = m.filter((x) => (x as any).active !== false);
      const ids = activeMembers.map((x) => x.id);
      const [t, av] = await Promise.all([
        listTimeOff(ids, from, to).catch(() => [] as TimeOff[]),
        Promise.all(ids.map((id) => listAvailability(id).catch(() => [] as AvailabilityRow[]))),
      ]);
      if (mine !== seq.current) return;
      setShop(s);
      setMembers(activeMembers);
      setServices(sv.filter((x) => (x as any).active !== false));
      setAppts(a);
      setTimeOff(t);
      setAvailability(av.flat());
      loadedRange.current = { lo, hi };
      setPhase('ready');
    } catch (e) {
      if (mine !== seq.current) return;
      console.warn('[bookings] load failed', e);
      // Keep what is on screen when a refresh fails; only a first load shows the error card.
      setPhase((p) => (p === 'ready' ? p : 'error'));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      return () => {
        seq.current++;
      };
    }, [refresh]),
  );

  // Paging to a week / month outside the loaded window reloads it (the window is the view +/- a month, so rarely).
  const key = visible ? `${visible.from}|${visible.to}` : '';
  useEffect(() => {
    const l = loadedRange.current;
    if (!visible || phase !== 'ready' || !l) return;
    if (visible.from >= l.lo && visible.to <= l.hi) return;
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, phase]);

  return { phase, shop, members, services, appts, timeOff, availability, refresh };
}
