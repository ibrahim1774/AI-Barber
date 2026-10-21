import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { GearIcon } from '@/components/Icons';
import { ShareIcon } from '@/components/bookings/icons';

/** Shop name, Share, and (unless the subscription has lapsed) the setup gear. */
export function StoreHeader({
  title, locked, onShare, onSetup,
}: {
  title: string;
  locked: boolean;
  onShare(): void;
  onSetup(): void;
}) {
  return (
    <View style={styles.header}>
      <Text style={styles.title} numberOfLines={1} accessibilityRole="header">{title}</Text>
      <View style={styles.btns}>
        <Pressable onPress={onShare} hitSlop={10} accessibilityRole="button" accessibilityLabel="Share shop link">
          <ShareIcon size={22} color={colors.text} />
        </Pressable>
        {!locked && (
          <Pressable onPress={onSetup} hitSlop={10} accessibilityRole="button" accessibilityLabel="Store setup">
            <GearIcon size={22} color={colors.text} />
          </Pressable>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14,
  },
  title: { flex: 1, fontFamily: fonts.heading, fontSize: 24, color: colors.heading },
  btns: { flexDirection: 'row', alignItems: 'center', gap: 18 },
});
