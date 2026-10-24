import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { RefObject } from 'react';
import { colors, fonts } from '@/constants/theme';
import type { PreviewPage } from '@/lib/editable';
import type { PageChips } from '@/lib/sitePages';

const same = (a: PreviewPage, b: PreviewPage) => a.key === b.key && a.index === b.index;

/**
 * The strip above the preview: the Pages button (left, away from the corner the dev tools use) and, for a
 * multi-page site, a chip per page in the nav. On Services or Team a second row has a chip per service or
 * barber page. Tapping a chip shows that page in the preview.
 */
export function PagesBar({
  chips, current, onSelect, onOpenPages, buttonRef, disabled,
}: {
  chips: PageChips;
  current: PreviewPage;
  onSelect(page: PreviewPage): void;
  onOpenPages(): void;
  buttonRef?: RefObject<View | null>;
  disabled?: boolean;
}) {
  const kids = current.key === 'services' ? chips.children.services : current.key === 'team' ? chips.children.team : undefined;
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Pressable
          ref={buttonRef}
          collapsable={false}
          accessibilityRole="button"
          accessibilityLabel="Pages"
          accessibilityHint="Turn pages on or off and set their order"
          onPress={onOpenPages}
          disabled={disabled}
          style={({ pressed }) => [styles.pages, (pressed || disabled) && { opacity: 0.6 }]}
        >
          <Text style={styles.pagesText}>Pages</Text>
        </Pressable>
        {chips.top.length > 0 ? (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.scroll}>
            {chips.top.map((c) => (
              <Chip key={c.key} label={c.title} on={current.key === c.key && current.index === undefined} onPress={() => onSelect({ key: c.key })} />
            ))}
          </ScrollView>
        ) : (
          <Text style={styles.single} numberOfLines={1}>One page. Tap Pages to add more.</Text>
        )}
      </View>
      {kids && kids.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.kids}>
          {kids.map((k) => (
            <Chip key={`${k.group}-${k.index}`} small label={k.title} on={same(current, { key: current.key, index: k.index })} onPress={() => onSelect({ key: current.key, index: k.index })} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

function Chip({ label, on, small, onPress }: { label: string; on: boolean; small?: boolean; onPress(): void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Show ${label}`}
      accessibilityState={{ selected: on }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, small && styles.chipSmall, on && styles.chipOn, pressed && { opacity: 0.6 }]}
    >
      <Text style={[styles.chipText, small && styles.chipTextSmall, on && styles.chipTextOn]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: '#111111', borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.1)', paddingVertical: 8 },
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: 10, gap: 8 },
  pages: { paddingHorizontal: 14, height: 34, justifyContent: 'center', borderRadius: 17, backgroundColor: colors.accent },
  pagesText: { fontFamily: fonts.headingBlack, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: colors.buttonInk },
  scroll: { flex: 1 },
  kids: { marginTop: 8 },
  chips: { gap: 6, paddingRight: 10, paddingLeft: 2, alignItems: 'center' },
  single: { flex: 1, fontFamily: fonts.body, fontSize: 12, color: 'rgba(255,255,255,0.55)', paddingRight: 10 },
  chip: {
    height: 34, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 17,
    backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  chipSmall: { height: 30, paddingHorizontal: 12, borderRadius: 15, marginLeft: 10 },
  chipOn: { backgroundColor: 'rgba(244,161,0,0.16)', borderColor: colors.accent },
  chipText: { fontFamily: fonts.bodySemi, fontSize: 13, color: '#fff' },
  chipTextSmall: { fontSize: 12 },
  chipTextOn: { color: colors.accent },
});
