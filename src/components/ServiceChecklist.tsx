import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { SERVICE_CHOICES, setPickPrice, tickedCount, togglePick, type ServicePicks } from '@/lib/serviceChecklist';

/**
 * "Add your services (optional)": the services the barber offers, each with an optional price.
 * Collapsed by default. Nothing ticked means the website has no Services section.
 * `tone`: 'dark' on the classic form, 'light' on the white import card.
 */
export function ServiceChecklist({
  picks, onChange, tone = 'light', startOpen = false,
}: { picks: ServicePicks; onChange(p: ServicePicks): void; tone?: 'dark' | 'light'; startOpen?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  const dark = tone === 'dark';
  const n = tickedCount(picks);
  const ink = dark ? '#fff' : colors.ink;
  const muted = dark ? 'rgba(255,255,255,0.55)' : colors.inkMuted;
  const line = dark ? 'rgba(255,255,255,0.18)' : colors.inkLine;

  return (
    <View style={styles.wrap}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel="Add your services (optional)"
        onPress={() => setOpen((o) => !o)}
        hitSlop={6}
        style={styles.head}
      >
        <Text style={[styles.headText, { color: ink }]}>Add your services (optional)</Text>
        <Text style={[styles.headMeta, { color: muted }]}>{n ? `${n} ticked ` : ''}{open ? '▲' : '▼'}</Text>
      </Pressable>
      {open && (
        <View style={styles.list}>
          <Text style={[styles.note, { color: muted }]}>Tick what you offer. Prices are optional.</Text>
          {SERVICE_CHOICES.map((title) => {
            const on = !!picks[title]?.on;
            return (
              <View key={title} style={[styles.row, { borderBottomColor: line }]}>
                <Pressable
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={title}
                  onPress={() => onChange(togglePick(picks, title))}
                  style={styles.tick}
                >
                  <View style={[styles.box, { borderColor: on ? colors.accent : line }, on && styles.boxOn]}>
                    {on && <Text style={styles.check}>✓</Text>}
                  </View>
                  <Text style={[styles.title, { color: ink }]}>{title}</Text>
                </Pressable>
                {on && (
                  <TextInput
                    accessibilityLabel={`${title} price`}
                    placeholder="Price"
                    placeholderTextColor={muted}
                    value={picks[title]?.price ?? ''}
                    onChangeText={(t) => onChange(setPickPrice(picks, title, t))}
                    keyboardType="numbers-and-punctuation"
                    autoCorrect={false}
                    style={[styles.price, { color: ink, borderBottomColor: line }]}
                  />
                )}
              </View>
            );
          })}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  headText: { fontFamily: fonts.bodyBold, fontSize: 14 },
  headMeta: { fontFamily: fonts.body, fontSize: 12 },
  list: { gap: 2 },
  note: { fontFamily: fonts.body, fontSize: 12, marginBottom: 4 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 44, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12 },
  tick: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  box: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  boxOn: { backgroundColor: colors.accent },
  check: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.accentInk },
  title: { fontFamily: fonts.body, fontSize: 15 },
  price: { width: 84, fontFamily: fonts.body, fontSize: 15, paddingVertical: 6, borderBottomWidth: 1, textAlign: 'right' },
});
