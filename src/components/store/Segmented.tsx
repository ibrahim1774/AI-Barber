import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';

export type Segment<T extends string> = { key: T; label: string; badge?: number };

/** Two-or-more segment switch (Products · Orders). A badge shows a count on a segment. */
export function Segmented<T extends string>({
  options, value, onChange,
}: {
  options: Segment<T>[];
  value: T;
  onChange(v: T): void;
}) {
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={o.badge ? `${o.label}, ${o.badge} new` : o.label}
            style={[styles.seg, on && styles.segOn]}
          >
            <Text style={[styles.text, on && styles.textOn]}>{o.label}</Text>
            {!!o.badge && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{o.badge > 99 ? '99+' : o.badge}</Text>
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row', marginHorizontal: 16, padding: 3, borderRadius: 12,
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: colors.hair,
  },
  seg: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 9, borderRadius: 9 },
  segOn: { backgroundColor: colors.accent },
  text: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.chipText },
  textOn: { color: colors.accentInk },
  badge: {
    minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  badgeText: { fontFamily: fonts.bodyBold, fontSize: 11, color: colors.accentInk },
});
