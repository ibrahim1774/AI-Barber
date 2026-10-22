import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { STOCK_NUDGE } from '@/lib/editor';

/** One line over the editor while any shown photo is a sample one; "Add photos" opens the Photos sheet. */
export function StockPhotoNudge({ onAddPhotos }: { onAddPhotos(): void }) {
  return (
    <View style={styles.bar} accessibilityRole="summary">
      <Text style={styles.text}>{STOCK_NUDGE}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Add photos" hitSlop={8} onPress={onAddPhotos}>
        <Text style={styles.action}>Add photos</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 10,
    backgroundColor: 'rgba(244,161,0,0.12)', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(244,161,0,0.35)',
  },
  text: { flex: 1, fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.text },
  action: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.accent },
});
