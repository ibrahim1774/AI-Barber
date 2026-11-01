import { ActionSheetIOS } from '@/lib/actionSheet';
import { Pressable, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors } from '@/constants/theme';
import { PlusIcon } from '@/components/bookings/icons';
import { useTutorialTarget } from '@/components/tutorial/registry';

/** Floating +: Add booking / Block time. */
export function Fab({ onAdd, onBlock }: { onAdd(): void; onBlock(): void }) {
  const insets = useSafeAreaInsets();
  const ref = useTutorialTarget('bookings.add');
  const open = () =>
    ActionSheetIOS.showActionSheetWithOptions(
      { options: ['Add booking', 'Block time', 'Cancel'], cancelButtonIndex: 2 },
      (i) => {
        if (i === 0) onAdd();
        if (i === 1) onBlock();
      },
    );
  return (
    <Pressable
      ref={ref}
      collapsable={false}
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel="Add booking or block time"
      style={({ pressed }) => [styles.fab, { bottom: 20 + Math.min(insets.bottom, 8) }, pressed && { opacity: 0.85 }]}
    >
      <PlusIcon size={28} color={colors.accentInk} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: 'absolute', right: 20, width: 58, height: 58, borderRadius: 29, backgroundColor: colors.accent,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 6,
  },
});
