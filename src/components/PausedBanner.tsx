import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { useEntitlements } from '@/lib/entitlements';
import { MoveSubscriptionButton } from '@/components/MoveSubscriptionButton';
import { otherAccountPlanMessage } from '@/lib/claimCopy';

export const PAUSED_COPY = {
  bookings: 'Your booking page is paused. Upgrade to Bookings to reopen it.',
  store: 'Your shop page is offline. Upgrade to Store to reopen it.',
} as const;

/** Shown above a read-only Bookings or Store tab whose page the plan no longer covers. */
export function PausedBanner({ kind, onUpgrade, action = 'Upgrade' }: { kind: 'bookings' | 'store'; onUpgrade(): void; action?: string }) {
  const ents = useEntitlements();
  if (ents.account === 'other') {
    return (
      <View style={styles.banner} accessibilityRole="alert">
        <Text style={styles.text}>{otherAccountPlanMessage(ents.hint)}</Text>
        <MoveSubscriptionButton />
      </View>
    );
  }
  return (
    <View style={styles.banner} accessibilityRole="alert">
      <Text style={styles.text}>{PAUSED_COPY[kind]}</Text>
      <Button title={action} onPress={onUpgrade} variant="ghost" style={styles.btn} />
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
