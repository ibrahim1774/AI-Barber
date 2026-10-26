import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { ChevronRightIcon } from '@/components/Icons';

/** The first card in Settings: gold-bordered, with a small New tag. */
export function LearnEntry({ onPress }: { onPress(): void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Learn how it works"
      style={({ pressed }) => [styles.card, pressed && styles.pressed]}
    >
      <View style={styles.text}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>Learn how it works</Text>
          <View style={styles.tag}>
            <Text style={styles.tagText}>New</Text>
          </View>
        </View>
        <Text style={styles.sub}>Step-by-step guides to editing, bookings, your store and getting paid.</Text>
      </View>
      <ChevronRightIcon size={16} color={colors.accent} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, marginBottom: 28, borderRadius: 14,
    backgroundColor: colors.sheet, borderWidth: 1.5, borderColor: colors.accent,
  },
  pressed: { backgroundColor: 'rgba(255,255,255,0.04)' },
  text: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontFamily: fonts.bodySemi, fontSize: 16, color: colors.text },
  tag: { backgroundColor: colors.accent, borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  tagText: { fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: colors.accentInk },
  sub: { fontFamily: fonts.body, fontSize: 13, lineHeight: 18, color: colors.muted, marginTop: 4 },
});
