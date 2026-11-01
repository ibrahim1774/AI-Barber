import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { TIPS, baselineOf, dismissTip, loadBaseline, loadTips, setTipsOff, useTipsState, visibleTips, type Baseline, type TipId } from '@/lib/webTips';
import type { WebTipsProps } from '@/components/WebTips';

/**
 * Non-blocking hints above the editor's tool bar: small tappable chips (a pulsing dot + one line), never an overlay.
 * Tapping a chip opens what it talks about; the X dismisses it for this device; a tip goes away by itself once the
 * owner has done that action; "Hide tips" turns them all off (Settings turns them back on).
 */
export function WebTips({ data, draftId, published, hidden, actions }: WebTipsProps) {
  const tips = useTipsState();
  const [base, setBase] = useState<Baseline | null>(null);
  useEffect(() => { void loadTips(); }, []);
  useEffect(() => {
    let alive = true;
    setBase(null);
    void loadBaseline(draftId, data).then((b) => { if (alive) setBase(b); });
    return () => { alive = false; };
    // The starting point is read once per draft; later edits are compared against it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftId]);
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const a = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 0.3, duration: 800, useNativeDriver: false }),
      Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: false }),
    ]));
    a.start();
    return () => a.stop();
  }, [pulse]);

  if (hidden || !tips.loaded) return null;
  const list = visibleTips(data, base, published, tips);
  if (!list.length) return null;
  const chips = list.filter((t) => t.id !== 'publish');
  const publish = list.find((t) => t.id === 'publish');

  const Chip = ({ id, strong }: { id: TipId; strong?: boolean }) => (
    <View style={[st.chip, strong && st.chipStrong]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={TIPS[id].label}
        onPress={actions[id]}
        style={st.chipMain}
      >
        <Animated.View style={[st.dot, strong && st.dotStrong, { opacity: pulse }]} />
        <Text style={[st.chipText, strong && st.chipTextStrong]} numberOfLines={strong ? 2 : 1}>{TIPS[id].text}</Text>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Dismiss tip: ${TIPS[id].text}`} hitSlop={8} onPress={() => dismissTip(id)} style={st.x}>
        <Text style={[st.xText, strong && st.chipTextStrong]}>×</Text>
      </Pressable>
    </View>
  );

  return (
    <View style={st.wrap} pointerEvents="box-none" accessibilityLabel="Editing tips">
      {chips.length > 0 && (
        <View style={st.row}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={st.chips} style={{ flex: 1 }}>
            {chips.map((t) => <Chip key={t.id} id={t.id} />)}
          </ScrollView>
          <Pressable accessibilityRole="button" accessibilityLabel="Hide tips" hitSlop={8} onPress={() => setTipsOff(true)} style={st.hide}>
            <Text style={st.hideText}>Hide tips</Text>
          </Pressable>
        </View>
      )}
      {publish && (
        <View style={st.pubRow}>
          <Chip id="publish" strong={publish.prominent} />
          {chips.length === 0 && (
            <Pressable accessibilityRole="button" accessibilityLabel="Hide tips" hitSlop={8} onPress={() => setTipsOff(true)} style={st.hide}>
              <Text style={st.hideText}>Hide tips</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const st = StyleSheet.create({
  wrap: { paddingTop: 8, paddingHorizontal: 12, gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  chips: { gap: 8, paddingRight: 8 },
  pubRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', borderRadius: 999, borderWidth: 1, borderColor: colors.accent, backgroundColor: 'rgba(0,0,0,0.55)', maxWidth: 320 },
  chipStrong: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipMain: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingLeft: 12, paddingRight: 4, flexShrink: 1 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.accent },
  dotStrong: { backgroundColor: colors.accentInk },
  chipText: { color: colors.text, fontFamily: fonts.bodyMedium, fontSize: 13, flexShrink: 1 },
  chipTextStrong: { color: colors.accentInk, fontFamily: fonts.bodyBold },
  x: { paddingHorizontal: 10, paddingVertical: 6 },
  xText: { color: colors.text, fontFamily: fonts.body, fontSize: 18, lineHeight: 18 },
  hide: { paddingVertical: 6, paddingHorizontal: 4 },
  hideText: { color: colors.body, fontFamily: fonts.body, fontSize: 12, textDecorationLine: 'underline' },
});
