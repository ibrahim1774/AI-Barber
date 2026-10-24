import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useEffect, useRef } from 'react';
import type { ReactNode, RefObject } from 'react';
import { colors, fonts } from '@/constants/theme';
import type { PreviewPage } from '@/lib/editable';
import type { PageChips } from '@/lib/sitePages';

const same = (a: PreviewPage, b: PreviewPage) => a.key === b.key && a.index === b.index;

/**
 * The page tabs at the bottom of the editor, directly above the tool bar: a scrolling tab per page in the
 * nav (the current one in the gold accent, scrolled into view) and a Pages button pinned at the right that
 * opens the manage / reorder / hide sheet. On Services or Team a smaller second row above has a chip per
 * service or barber page. A single-page site has no tabs, only the Pages button (the way to add pages).
 */
export function PagesBar({
  chips, current, onSelect, onOpenPages, buttonRef, disabled, leading,
}: {
  chips: PageChips;
  current: PreviewPage;
  onSelect(page: PreviewPage): void;
  onOpenPages(): void;
  buttonRef?: RefObject<View | null>;
  disabled?: boolean;
  /** Pinned at the left of the tabs row (the design switcher). */
  leading?: ReactNode;
}) {
  const kids = current.key === 'services' ? chips.children.services : current.key === 'team' ? chips.children.team : undefined;
  const topScroll = useRef<ScrollView>(null);
  const kidScroll = useRef<ScrollView>(null);
  const topX = useRef<Record<string, number>>({});
  const kidX = useRef<Record<string, number>>({});
  const selTop = current.key;
  const selKid = current.index === undefined ? '' : `${current.key}-${current.index}`;
  useEffect(() => {
    const x = topX.current[selTop];
    if (x != null) topScroll.current?.scrollTo({ x: Math.max(0, x - 24), animated: true });
  }, [selTop, chips.top.length]);
  useEffect(() => {
    const x = kidX.current[selKid];
    if (x != null) kidScroll.current?.scrollTo({ x: Math.max(0, x - 24), animated: true });
  }, [selKid]);
  return (
    <View style={styles.wrap}>
      {kids && kids.length > 0 && (
        <ScrollView ref={kidScroll} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.kids}>
          {kids.map((k) => {
            const id = `${k.group}-${k.index}`;
            return (
              <Chip
                key={id}
                small
                label={k.title}
                on={same(current, { key: current.key, index: k.index })}
                disabled={disabled}
                onLayout={(x) => { kidX.current[`${current.key}-${k.index}`] = x; }}
                onPress={() => onSelect({ key: current.key, index: k.index })}
              />
            );
          })}
        </ScrollView>
      )}
      <View style={styles.row}>
        {leading}
        {chips.top.length > 0 && (
          <ScrollView ref={topScroll} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.scroll}>
            {chips.top.map((c) => (
              <Chip
                key={c.key}
                label={c.title}
                on={current.key === c.key && current.index === undefined}
                disabled={disabled}
                onLayout={(x) => { topX.current[c.key] = x; }}
                onPress={() => onSelect({ key: c.key })}
              />
            ))}
          </ScrollView>
        )}
        <Pressable
          ref={buttonRef}
          collapsable={false}
          accessibilityRole="button"
          accessibilityLabel="Pages"
          accessibilityHint="Turn pages on or off and set their order"
          accessibilityState={{ disabled: !!disabled }}
          onPress={onOpenPages}
          disabled={disabled}
          style={({ pressed }) => [styles.pages, chips.top.length === 0 && styles.pagesAlone, (pressed || disabled) && { opacity: 0.6 }]}
        >
          <Text style={styles.pagesText}>Pages</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Chip({
  label, on, small, disabled, onPress, onLayout,
}: { label: string; on: boolean; small?: boolean; disabled?: boolean; onPress(): void; onLayout?(x: number): void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Show ${label}`}
      accessibilityState={{ selected: on, disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      onLayout={(e) => onLayout?.(e.nativeEvent.layout.x)}
      style={({ pressed }) => [styles.chip, small && styles.chipSmall, on && styles.chipOn, (pressed || disabled) && { opacity: 0.6 }]}
    >
      <Text style={[styles.chipText, small && styles.chipTextSmall, on && styles.chipTextOn]} numberOfLines={1}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: '#111111', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', paddingTop: 6, paddingBottom: 2 },
  row: { flexDirection: 'row', alignItems: 'center', paddingLeft: 6, paddingRight: 10, gap: 8 },
  pages: { paddingHorizontal: 16, height: 44, justifyContent: 'center', borderRadius: 22, backgroundColor: colors.accent },
  pagesAlone: { marginLeft: 'auto' },
  pagesText: { fontFamily: fonts.headingBlack, fontSize: 11, letterSpacing: 1, textTransform: 'uppercase', color: colors.buttonInk },
  scroll: { flex: 1 },
  kids: { marginBottom: 4, flexGrow: 0 },
  chips: { gap: 6, paddingRight: 6, paddingLeft: 4, alignItems: 'center' },
  chip: {
    height: 44, paddingHorizontal: 16, justifyContent: 'center', borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  chipSmall: { height: 44, paddingHorizontal: 14, borderRadius: 22, marginLeft: 6 },
  chipOn: { backgroundColor: 'rgba(244,161,0,0.16)', borderColor: colors.accent },
  chipText: { fontFamily: fonts.bodySemi, fontSize: 13, color: '#fff' },
  chipTextSmall: { fontSize: 12 },
  chipTextOn: { color: colors.accent },
});
