import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';

/**
 * Stand-in until A3b's `OrdersPane.tsx` merges; the controller swaps the
 * import in `(tabs)/store.tsx`. Same props as the real one.
 */
export function OrdersPane(_props: {
  shopId: string;
  shopName: string;
  locked: boolean;
  focusOrderId?: string;
  onChanged(): void;
}) {
  return (
    <View style={styles.box}>
      <Text style={styles.text}>Orders are coming soon.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { padding: 24, alignItems: 'center' },
  text: { fontFamily: fonts.body, fontSize: 15, color: colors.muted },
});
