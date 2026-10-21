import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';

export const PAUSED_COPY = {
  bookings: 'Your booking page is paused. Upgrade to Bookings to reopen it.',
  store: 'Your shop page is offline. Upgrade to Store to reopen it.',
} as const;

/** Shown above a read-only Bookings or Store tab whose page the plan no longer covers. */
export function PausedBanner({ kind, onUpgrade }: { kind: 'bookings' | 'store'; onUpgrade(): void }) {
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Text style={styles.text}>{PAUSED_COPY[kind]}</Text>
      <Button title="Upgrade" onPress={onUpgrade} variant="ghost" style={styles.btn} />
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginHorizontal: 16, marginBottom: 12, padding: 14, borderRadius: 12, borderWidth: 1, borderColor: colors.hair,
    backgroundColor: colors.sheet, gap: 10,
  },
  text: { fontFamily: fonts.bodySemi, fontSize: 13, lineHeight: 19, color: colors.accent },
  btn: { alignSelf: 'flex-start' },
});
