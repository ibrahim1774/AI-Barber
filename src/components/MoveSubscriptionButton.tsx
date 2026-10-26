import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { MOVE_BUTTON_TITLE } from '@/lib/claimCopy';
import { useMoveSubscription } from '@/lib/useMoveSubscription';

/** The way out of "this subscription belongs to another account": moves it here after a confirm. */
export function MoveSubscriptionButton({
  transactionId, onMoved, style,
}: { transactionId?: () => Promise<string | null>; onMoved?: () => void | Promise<void>; style?: StyleProp<ViewStyle> }) {
  const { run, busy, error, notice } = useMoveSubscription({ transactionId, onMoved });
  return (
    <View style={[styles.wrap, style]}>
      <Button variant="solid" title={MOVE_BUTTON_TITLE} onPress={() => void run()} loading={busy} />
      {!!notice && <Text style={styles.notice} accessibilityLiveRegion="polite">{notice}</Text>}
      {!!error && <Text style={styles.error} accessibilityLiveRegion="polite">{error}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignSelf: 'stretch', gap: 10 },
  notice: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: '#a3a3a3' },
  error: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: '#f87171' },
});
