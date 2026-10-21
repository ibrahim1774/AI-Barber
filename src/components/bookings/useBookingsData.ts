import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { listAppointments, listTimeOff } from '@/lib/bookings/api';
import { addDays, dayRange, todayKey, type Appointment, type TimeOff } from '@/lib/bookings/calendar';
import { listMembers, listServices, loadMyShop, type Member, type Service, type Shop } from '@/lib/bookings/shop';

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
  refresh(): Promise<void>;
}

/** Loads the shop, its barbers and services, and the strip's window of bookings; reloads on focus. */
export function useBookingsData(): BookingsData {
  const [phase, setPhase] = useState<Phase>('loading');
  const [shop, setShop] = useState<Shop | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [timeOff, setTimeOff] = useState<TimeOff[]>([]);
  const seq = useRef(0);

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
      const from = dayRange(addDays(today, -DAYS_BACK), s.timezone).start;
      const to = dayRange(addDays(today, DAYS_AHEAD + 1), s.timezone).start;
      const [m, sv, a] = await Promise.all([listMembers(s.id), listServices(s.id), listAppointments(s.id, from, to)]);
      const activeMembers = m.filter((x) => (x as any).active !== false);
      const t = await listTimeOff(activeMembers.map((x) => x.id), from, to).catch(() => [] as TimeOff[]);
      if (mine !== seq.current) return;
      setShop(s);
      setMembers(activeMembers);
      setServices(sv.filter((x) => (x as any).active !== false));
      setAppts(a);
      setTimeOff(t);
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

  return { phase, shop, members, services, appts, timeOff, refresh };
}
