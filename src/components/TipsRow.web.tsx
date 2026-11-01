import { useEffect } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { loadTips, setTipsOff, showTipsAgain, useTipsState } from '@/lib/webTips';

/** Settings (web): the one switch for the editor's hints. Turning them on brings back the ones that were dismissed. */
export function TipsRow() {
  const tips = useTipsState();
  useEffect(() => { void loadTips(); }, []);
  const on = !tips.off;
  return (
    <View style={st.section}>
      <Text style={st.title}>Editor</Text>
      <View style={st.group}>
        <View style={st.row}>
          <View style={{ flex: 1 }}>
            <Text style={st.label}>Editing tips</Text>
            <Text style={st.detail}>{on ? 'Hide tips' : 'Show tips'}: small hints in the editor</Text>
          </View>
          <Switch value={on} onValueChange={(v) => (v ? showTipsAgain() : setTipsOff(true))} accessibilityLabel={on ? 'Hide tips' : 'Show tips'} trackColor={{ true: colors.accent }} />
        </View>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  section: { marginBottom: 28 },
  title: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: colors.muted, marginBottom: 8, marginLeft: 4 },
  group: { backgroundColor: colors.sheet, borderRadius: 14, borderWidth: 1, borderColor: colors.hair, overflow: 'hidden' },
  row: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12 },
  label: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.text },
  detail: { fontFamily: fonts.body, fontSize: 13, color: colors.muted, marginTop: 2 },
});
