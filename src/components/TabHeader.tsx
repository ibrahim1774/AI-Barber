import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';

/**
 * Tab title plus header buttons. One or two buttons sit beside the title; three
 * (Bookings) go on their own row under it, sharing the width equally, so the row
 * fits any phone from 320 to 430 pt with no overflow.
 */
export function TabHeader({ title, children }: { title: 'Store' | 'Bookings'; children: ReactNode }) {
  const items = Children.toArray(children).filter(Boolean);
  if (items.length < 3) {
    return (
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">{title}</Text>
        {children}
      </View>
    );
  }
  return (
    <View style={styles.stack}>
      <Text style={styles.title} accessibilityRole="header">{title}</Text>
      <View style={styles.pills} testID="tab-header-pills">
        {items.map((c) => (isValidElement(c) ? cloneElement(c as ReactElement<{ fill?: boolean }>, { fill: true }) : c))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-evenly', gap: 8,
    paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14,
  },
  stack: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 14, gap: 10 },
  pills: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  title: { fontFamily: fonts.heading, fontSize: 24, color: colors.heading, flexShrink: 0 },
});
