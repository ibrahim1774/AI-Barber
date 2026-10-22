import { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { PausedBanner } from '@/components/PausedBanner';
import { UpgradeCard } from '@/components/UpgradeCard';
import { GearIcon } from '@/components/Icons';
import { ShareSheet } from '@/components/ShareSheet';
import { AddBookingSheet } from '@/components/bookings/AddBookingSheet';
import { AppointmentRow, TimeOffRow } from '@/components/bookings/AppointmentRow';
import { AppointmentSheet } from '@/components/bookings/AppointmentSheet';
import { BlockTimeSheet } from '@/components/bookings/BlockTimeSheet';
import { BarberChips } from '@/components/bookings/Chips';
import { DateStrip } from '@/components/bookings/DateStrip';
import { EmptyDay } from '@/components/bookings/EmptyDay';
import { Fab } from '@/components/bookings/Fab';
import { ShareIcon } from '@/components/bookings/icons';
import { DAYS_AHEAD, DAYS_BACK, useBookingsData } from '@/components/bookings/useBookingsData';
import {
  appointmentsForDay, countsByDay, dateFromPushData, dayHeading, stripDays, timeOffForDay, todayKey, type DateKey,
} from '@/lib/bookings/calendar';
import { BOOKING_SHARE_KIND, memberName } from '@/lib/bookings/shop';
import { useCustomerLinks } from '@/lib/customerLinks';
import { loadSite, type SiteRecord } from '@/lib/siteStore';
import { isLocked, useSubscriptionStatus } from '@/lib/subscriptionStatus';
import { useTierAccess, useUpgrade } from '@/lib/tierAccess';

/**
 * The Bookings tab (spec 5.2): a date strip, barber chips when there is more
 * than one barber, the day's appointments, and a floating + for Add booking /
 * Block time. All times are in the shop's timezone. Read-only once the
 * subscription has lapsed.
 */
export default function Bookings() {
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ date?: string; start?: string }>();
  const { phase, shop, members, services, appts, timeOff, refresh } = useBookingsData();
  const status = useSubscriptionStatus();
  const tier = useTierAccess('bookings');
  const upgrade = useUpgrade('bookings_upgrade');
  const [site, setSite] = useState<SiteRecord | null>(null);
  const [selected, setSelected] = useState<DateKey | null>(null);
  const [barber, setBarber] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [pulling, setPulling] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      loadSite().then((s) => alive && setSite(s)).catch(() => {});
      return () => {
        alive = false;
      };
    }, []),
  );

  const tz = shop?.timezone ?? 'UTC';
  const today = todayKey(tz);
  const lapsed = isLocked(site, status);
  // The plan not covering bookings (a Website plan) is read-only too; the server pauses the page.
  const paused = tier.status === 'ready' && !tier.entitled;
  const locked = lapsed || paused;
  const day = selected ?? today;

  // A tapped booking push opens the tab on that day (once the shop's timezone is known).
  const pushDate = shop ? dateFromPushData(params, tz) : null;
  useEffect(() => {
    if (pushDate) setSelected(pushDate);
  }, [pushDate, params.date, params.start]);

  const days = useMemo(() => {
    const base = stripDays(today, DAYS_BACK, DAYS_AHEAD);
    return base.includes(day) ? base : [...base, day].sort();
  }, [today, day]);
  const counts = useMemo(() => countsByDay(appts, tz, barber), [appts, tz, barber]);
  const dayAppts = useMemo(() => appointmentsForDay(appts, day, tz, barber), [appts, day, tz, barber]);
  const dayBlocks = useMemo(() => timeOffForDay(timeOff, day, tz, barber), [timeOff, day, tz, barber]);
  const names = useMemo(() => new Map(members.map((m) => [m.id, memberName(m)])), [members]);
  const several = members.length > 1;
  const open = openId ? appts.find((a) => a.id === openId) ?? null : null;
  const customer = useCustomerLinks(shop);
  const link = shop ? customer?.booking ?? '' : '';

  const pull = async () => {
    setPulling(true);
    await refresh();
    setPulling(false);
  };

  if (tier.status === 'error') {
    return (
      <View style={[styles.root, styles.center, { paddingTop: insets.top }]}>
        <Card
          title="Couldn't load your plan"
          body="Check your connection and try again."
          action="Try again"
          onAction={() => {
            tier.retry();
            void refresh();
          }}
        />
      </View>
    );
  }

  if (tier.status === 'loading' || phase === 'loading') {
    return (
      <View style={[styles.root, styles.center, { paddingTop: insets.top }]}>
        <ActivityIndicator color={colors.accent} />
      </View>
    );
  }

  if (phase === 'error') {
    return (
      <View style={[styles.root, styles.center, { paddingTop: insets.top }]}>
        <Card
          title="Couldn't load your bookings"
          body="Check your connection and try again."
          action="Try again"
          onAction={() => void refresh()}
        />
      </View>
    );
  }

  // No bookings plan and nothing to look at (no shop yet, or hosting lapsed over 30 days ago): sell the plan.
  if (paused && (phase === 'no-shop' || !shop || tier.expired)) {
    return (
      <View style={[styles.root, styles.center, { paddingTop: insets.top }]}>
        <UpgradeCard kind="bookings" onUpgrade={() => void upgrade.run()} busy={upgrade.busy} />
      </View>
    );
  }

  if (phase === 'no-shop' || !shop) {
    return (
      <View style={[styles.root, styles.center, { paddingTop: insets.top }]}>
        <Card
          title="Set up bookings"
          body="Let clients book online, pick a barber and pay, and see your whole day here."
          action="Set up bookings"
          onAction={() => router.push('/bookings-setup' as never)}
        />
      </View>
    );
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <Text style={styles.title} numberOfLines={1} accessibilityRole="header">{shop.name}</Text>
        <View style={styles.headerBtns}>
          <Pressable onPress={() => setSharing(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Share booking link">
            <ShareIcon size={22} color={colors.text} />
          </Pressable>
          {!locked && (
            <Pressable
              onPress={() => router.push('/bookings-setup' as never)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Booking setup"
            >
              <GearIcon size={22} color={colors.text} />
            </Pressable>
          )}
        </View>
      </View>

      {lapsed && (
        <Text style={styles.locked}>Your subscription has ended. Bookings are read-only until you resubscribe.</Text>
      )}
      {paused && !lapsed && <PausedBanner kind="bookings" onUpgrade={() => void upgrade.run()} />}

      <DateStrip days={days} selected={day} today={today} counts={counts} onSelect={setSelected} />
      {several && <View style={styles.chips}><BarberChips members={members.map((m) => ({ id: m.id, name: memberName(m) }))} value={barber} onChange={setBarber} /></View>}

      <ScrollView
        style={styles.flex}
        contentContainerStyle={[styles.list, { paddingBottom: 110 + insets.bottom }]}
        refreshControl={<RefreshControl refreshing={pulling} onRefresh={() => void pull()} tintColor={colors.accent} />}
      >
        <Text style={styles.dayHeading}>{dayHeading(day, today)}</Text>
        {dayAppts.length === 0 && dayBlocks.length === 0 ? (
          <EmptyDay readOnly={locked} onShare={() => setSharing(true)} />
        ) : (
          <>
            {dayBlocks.map((b) => (
              <TimeOffRow key={b.id} block={b} tz={tz} barber={several ? names.get(b.memberId) : undefined} />
            ))}
            {dayAppts.map((a) => (
              <AppointmentRow
                key={a.id}
                appt={a}
                tz={tz}
                barber={several ? names.get(a.memberId) : undefined}
                onPress={() => setOpenId(a.id)}
              />
            ))}
          </>
        )}
      </ScrollView>

      {!locked && <Fab onAdd={() => setAdding(true)} onBlock={() => setBlocking(true)} />}

      <AppointmentSheet
        appt={open}
        tz={tz}
        today={today}
        barberName={open && several ? names.get(open.memberId) : undefined}
        bookingLink={link}
        rescheduleLocked={locked}
        onClose={() => setOpenId(null)}
        onChanged={refresh}
      />
      <AddBookingSheet
        visible={adding}
        tz={tz}
        today={today}
        day={day}
        defaultMemberId={barber}
        members={members}
        services={services}
        onClose={() => setAdding(false)}
        onAdded={async (d) => {
          setSelected(d);
          await refresh();
        }}
      />
      <BlockTimeSheet
        visible={blocking}
        tz={tz}
        today={today}
        day={day}
        defaultMemberId={barber}
        members={members}
        onClose={() => setBlocking(false)}
        onBlocked={refresh}
      />
      <ShareSheet
        visible={sharing}
        shopName={shop.name}
        links={[{ kind: BOOKING_SHARE_KIND, url: link }]}
        source="settings"
        onClose={() => setSharing(false)}
      />
    </View>
  );
}

function Card({ title, body, action, onAction }: { title: string; body: string; action: string; onAction(): void }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle} accessibilityRole="header">{title}</Text>
      <Text style={styles.cardBody}>{body}</Text>
      <Button title={action} onPress={onAction} style={styles.cardBtn} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  center: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14,
  },
  title: { flex: 1, fontFamily: fonts.heading, fontSize: 24, color: colors.heading },
  headerBtns: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  locked: { fontFamily: fonts.bodySemi, fontSize: 13, color: colors.accent, paddingHorizontal: 16, paddingBottom: 10 },
  chips: { marginTop: 12 },
  list: { paddingHorizontal: 16, paddingTop: 18 },
  dayHeading: {
    fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 2, textTransform: 'uppercase', color: colors.muted, marginBottom: 12,
  },
  card: {
    alignSelf: 'stretch', maxWidth: 460, alignItems: 'center', backgroundColor: colors.sheet, borderRadius: 18,
    borderWidth: 1, borderColor: colors.hair, paddingHorizontal: 22, paddingVertical: 32,
  },
  cardTitle: { fontFamily: fonts.heading, fontSize: 22, lineHeight: 28, color: colors.heading, textAlign: 'center', marginBottom: 10 },
  cardBody: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.muted, textAlign: 'center', marginBottom: 24 },
  cardBtn: { alignSelf: 'stretch' },
});
