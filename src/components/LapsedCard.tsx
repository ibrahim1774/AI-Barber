import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { AlertCircleIcon } from '@/components/Icons';

export const LAPSED_TITLE = 'Your subscription has ended';
export const LAPSED_BODY =
  'Your website is offline. Resubscribe to bring it back on the same link. Your site and edits are saved.';

/** The Edit tab in place of the editor once a published site's subscription has lapsed. */
export function LapsedCard({
  onResubscribe,
  onRestore,
  restoring,
}: {
  onResubscribe(): void;
  onRestore(): void;
  restoring: boolean;
}) {
  return (
    <View style={styles.root}>
      <View style={styles.card}>
        <View style={styles.badge}>
          <AlertCircleIcon size={36} color={colors.accent} />
        </View>
        <Text style={styles.title} accessibilityRole="header">
          {LAPSED_TITLE}
        </Text>
        <Text style={styles.body}>{LAPSED_BODY}</Text>
        <Button title="Resubscribe" onPress={onResubscribe} disabled={restoring} style={styles.wide} />
        <Button
          variant="ghost"
          title="Restore purchases"
          onPress={onRestore}
          loading={restoring}
          style={[styles.wide, styles.gap]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  card: {
    alignSelf: 'stretch', maxWidth: 460, alignItems: 'center',
    backgroundColor: colors.sheet, borderRadius: 18, borderWidth: 1, borderColor: colors.hair,
    paddingHorizontal: 22, paddingVertical: 32,
  },
  badge: {
    width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center', marginBottom: 20,
    backgroundColor: 'rgba(244,161,0,0.14)',
  },
  title: {
    fontFamily: fonts.heading, fontSize: 22, lineHeight: 28, color: colors.heading, textAlign: 'center', marginBottom: 12,
  },
  body: {
    fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.muted, textAlign: 'center', marginBottom: 28,
  },
  wide: { alignSelf: 'stretch' },
  gap: { marginTop: 12 },
});
