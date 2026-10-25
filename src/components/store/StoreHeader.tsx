import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { HeaderButton } from '@/components/HeaderButtons';

/** Shop name, a Share button, and (unless the subscription has lapsed) a labelled Settings button. */
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
        <HeaderButton title="Share" icon="share" tone="solid" onPress={onShare} accessibilityLabel="Share shop link" />
        {!locked && <HeaderButton title="Settings" icon="gear" onPress={onSetup} accessibilityLabel="Store setup" />}
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
  btns: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
