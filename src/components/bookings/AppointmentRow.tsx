import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { formatTime, statusChip, type Appointment, type ChipTone, type TimeOff } from '@/lib/bookings/calendar';

const TONES: Record<ChipTone, { bg: string; fg: string }> = {
  neutral: { bg: 'rgba(237,239,244,0.10)', fg: colors.chipText },
  good: { bg: 'rgba(34,197,94,0.16)', fg: '#4ade80' },
  warn: { bg: 'rgba(244,161,0,0.16)', fg: colors.accent },
  bad: { bg: 'rgba(239,68,68,0.16)', fg: '#f87171' },
};

export function StatusChip({ appt }: { appt: Pick<Appointment, 'status' | 'paymentStatus'> }) {
  const c = statusChip(appt);
  const t = TONES[c.tone];
  return (
    <View style={[styles.chip, { backgroundColor: t.bg }]}>
      <Text style={[styles.chipText, { color: t.fg }]}>{c.label}</Text>
    </View>
  );
}

/** time · customer · service (· barber when >1) · status chip. */
export function AppointmentRow({
  appt, tz, barber, onPress,
}: {
  appt: Appointment;
  tz: string;
  /** The barber's name; only passed when the shop has more than one. */
  barber?: string;
  onPress(): void;
}) {
  const who = appt.customerName?.trim() || 'Walk-in';
  const sub = barber ? `${appt.serviceName} · ${barber}` : appt.serviceName;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${formatTime(appt.start, tz)}, ${who}, ${sub}`}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.8 }]}
    >
      <Text style={styles.time}>{formatTime(appt.start, tz)}</Text>
      <View style={styles.mid}>
        <Text style={styles.name} numberOfLines={1}>{who}</Text>
        <Text style={styles.sub} numberOfLines={1}>{sub}</Text>
      </View>
      <StatusChip appt={appt} />
    </Pressable>
  );
}

export function TimeOffRow({ block, tz, barber }: { block: TimeOff; tz: string; barber?: string }) {
  const label = block.reason?.trim() || 'Blocked';
  return (
    <View style={[styles.row, styles.block]} accessibilityLabel={`Blocked ${formatTime(block.start, tz)} to ${formatTime(block.end, tz)}`}>
      <Text style={[styles.time, styles.blockText]}>{formatTime(block.start, tz)}</Text>
      <View style={styles.mid}>
        <Text style={[styles.name, styles.blockText]} numberOfLines={1}>{label}</Text>
        <Text style={styles.sub} numberOfLines={1}>
          Until {formatTime(block.end, tz)}{barber ? ` · ${barber}` : ''}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, paddingHorizontal: 14,
    backgroundColor: colors.sheet, borderRadius: 14, borderWidth: 1, borderColor: colors.hair, marginBottom: 8,
  },
  block: { backgroundColor: 'transparent', borderStyle: 'dashed', borderColor: colors.ghostBorder },
  blockText: { color: colors.muted },
  time: { width: 72, fontFamily: fonts.bodyBold, fontSize: 14, color: colors.accent },
  mid: { flex: 1 },
  name: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.heading },
  sub: { fontFamily: fonts.body, fontSize: 13, color: colors.muted, marginTop: 2 },
  chip: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  chipText: { fontFamily: fonts.bodyBold, fontSize: 12 },
});
