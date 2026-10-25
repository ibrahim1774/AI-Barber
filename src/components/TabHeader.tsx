import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';

/** Tab title plus header buttons, spread evenly across one row (fits a 375 pt phone). */
export function TabHeader({ title, children }: { title: 'Store' | 'Bookings'; children: ReactNode }) {
  return (
    <View style={styles.header}>
      <Text style={styles.title} accessibilityRole="header">{title}</Text>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', gap: 8,
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14,
  },
  title: { fontFamily: fonts.heading, fontSize: 24, color: colors.heading, flexShrink: 0 },
});
