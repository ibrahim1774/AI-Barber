import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text as RNText, View } from 'react-native';
import { router } from 'expo-router';
import { colors, fonts } from '@/constants/theme';
import { Screen } from '@/components/Screen';
import { CheckIcon } from '@/components/Icons';
import { FlowHelper, FlowTitle, PillButton } from '@/components/FlowParts';
import { backToStart } from '@/lib/nav';
import { loadSite } from '@/lib/siteStore';
import { importCounts, type ImportCounts } from '@/lib/importReview';

// Screen 4 of the start flow, between a successful import (booking link or Google) and the editor:
// what the import actually returned. A row is a tick only when its count is above zero; a missing one is a
// muted circle with an ADD chip. ADD and "Open my site" both continue to the editor, where it can be filled in.
export default function ImportReview() {
  const [counts, setCounts] = useState<ImportCounts | null>(null);
  const going = useRef(false);

  useEffect(() => {
    let alive = true;
    loadSite()
      .then((site) => {
        if (!alive) return;
        // Only an imported draft is reviewed. No draft: back to the start; a typed one: straight on.
        if (!site) { router.replace('/start'); return; }
        if (!site.inputs.importedFrom) { router.replace('/generating'); return; }
        setCounts(importCounts(site.data));
      })
      .catch(() => alive && router.replace('/start'));
    return () => { alive = false; };
  }, []);

  // One tap only: the screen is replaced by /generating, and a second tap while it leaves does nothing.
  const open = () => {
    if (going.current) return;
    going.current = true;
    router.replace('/generating');
  };

  const rows: { key: string; label: string; count: number; show: boolean }[] = counts
    ? [
        { key: 'services', label: 'Services', count: counts.services, show: true },
        { key: 'photos', label: 'Photos', count: counts.photos, show: true },
        { key: 'reviews', label: 'Reviews', count: counts.reviews, show: true },
        { key: 'hours', label: 'Hours', count: counts.hours, show: false },
      ]
    : [];
  const missing = rows.some((r) => r.count === 0);

  return (
    <Screen onBack={backToStart}>
      <FlowTitle first="Here's what" second="we found" />
      {counts && (
        <>
          <View style={styles.card}>
            {rows.map((r, i) => {
              const ok = r.count > 0;
              return (
                <View
                  key={r.key}
                  accessible
                  accessibilityLabel={ok ? `${r.label}${r.show ? `, ${r.count}` : ', found'}` : `${r.label}, not found`}
                  style={[styles.row, i < rows.length - 1 && styles.rowLine]}
                >
                  <View style={styles.mark}>
                    {ok ? <CheckIcon size={16} color={colors.accent} /> : <View style={styles.hollow} />}
                  </View>
                  <RNText style={[styles.label, !ok && { color: colors.text }]}>{r.label}</RNText>
                  {ok ? (
                    r.show ? <RNText style={styles.count}>{r.count}</RNText> : null
                  ) : (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Add ${r.label.toLowerCase()}`}
                      hitSlop={8}
                      onPress={open}
                      style={styles.chip}
                    >
                      <RNText style={styles.chipText}>Add</RNText>
                    </Pressable>
                  )}
                </View>
              );
            })}
          </View>
          {missing && <FlowHelper>Anything missing can be added in the editor.</FlowHelper>}
          <PillButton primary arrow title="Open my site" onPress={open} style={styles.cta} />
        </>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: {
    alignSelf: 'stretch', marginTop: 28, borderRadius: 26, borderWidth: 1, borderColor: colors.ghostBorder,
    backgroundColor: colors.ghostBg, paddingHorizontal: 20,
  },
  row: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 14 },
  rowLine: { borderBottomWidth: 1, borderBottomColor: colors.hair },
  mark: { width: 18, alignItems: 'center' },
  hollow: { width: 8, height: 8, borderRadius: 4, borderWidth: 1, borderColor: colors.faint },
  label: { flex: 1, fontFamily: fonts.body, fontSize: 15.5, color: colors.text },
  count: { fontFamily: fonts.bodyMedium, fontSize: 15.5, color: colors.text },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: colors.accent, paddingHorizontal: 12, paddingVertical: 5 },
  chipText: { fontFamily: fonts.bodyBold, fontSize: 10.5, letterSpacing: 1.8, textTransform: 'uppercase', color: colors.accent },
  cta: { marginTop: 24 },
});
