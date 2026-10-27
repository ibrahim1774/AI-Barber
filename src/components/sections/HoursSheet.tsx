import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import type { WebsiteData } from '@/web/types';
import { colors, fonts } from '@/constants/theme';
import { track } from '@/lib/analytics';
import { Sheet, SheetAction } from '@/components/EditSheet';
import { TIME_OPTIONS, copyDayToOpenDays, editableHours, hasNoHours, setDay, timeLabel, withDefaultHours } from '@/lib/sections/hours';

interface Props {
  visible: boolean;
  data: WebsiteData;
  /** Applied to the editor's latest data, so it composes with concurrent changes. */
  onChange(update: (d: WebsiteData) => WebsiteData): void;
  onClose(): void;
  onDismiss?(): void;
}

type Picking = { day: string; field: 'open' | 'close' } | null;

export function HoursSheet({ visible, data, onChange, onClose, onDismiss }: Props) {
  const [picking, setPicking] = useState<Picking>(null);
  const [note, setNote] = useState('');
  const changed = useRef(false);
  useEffect(() => {
    if (!visible) return;
    setPicking(null); setNote(''); changed.current = false;
    // A site with no hours opens on the 9-5 Monday-Saturday week; seed it so Done saves exactly what is shown.
    if (hasNoHours(data)) { changed.current = true; onChange(withDefaultHours); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const rows = editableHours(data);
  const apply = (update: (d: WebsiteData) => WebsiteData) => {
    if (update(data) === data) return false;
    changed.current = true;
    onChange(update);
    return true;
  };
  const done = () => {
    if (changed.current) track('section_saved', { section: 'hours' });
    changed.current = false;
    onClose();
  };
  const pick = (value: string) => {
    if (!picking) return;
    const ok = apply((d) => setDay(d, picking.day, { [picking.field]: value }));
    setNote(ok ? '' : 'Closing time has to be after opening time.');
    setPicking(null);
  };

  if (picking) {
    const current = rows.find((r) => r.day === picking.day)?.[picking.field] ?? '';
    const options = TIME_OPTIONS.includes(current) ? TIME_OPTIONS : [current, ...TIME_OPTIONS];
    return (
      <Sheet
        visible={visible}
        title={`${picking.day} ${picking.field === 'open' ? 'opens' : 'closes'}`}
        onClose={() => setPicking(null)}
        onDismiss={onDismiss}
        right={<SheetAction title="Back" onPress={() => setPicking(null)} />}
      >
        <ScrollView style={styles.list}>
          {options.map((t) => (
            <Pressable
              key={t}
              accessibilityRole="button"
              accessibilityState={{ selected: t === current }}
              onPress={() => pick(t)}
              style={({ pressed }) => [styles.option, t === current && styles.optionOn, pressed && styles.pressed]}
            >
              <Text style={[styles.optionText, t === current && styles.optionTextOn]}>{timeLabel(t)}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </Sheet>
    );
  }

  return (
    <Sheet visible={visible} title="Working hours" onClose={done} onDismiss={onDismiss} right={<SheetAction title="Done" primary onPress={done} />}>
      <ScrollView style={styles.list}>
        {rows.map((r) => (
          <View key={r.day} style={styles.row}>
            <Text style={styles.day}>{r.day}</Text>
            {r.closed ? (
              <Text style={styles.closed}>Closed</Text>
            ) : (
              <View style={styles.times}>
                <Pressable accessibilityRole="button" accessibilityLabel={`${r.day} opening time`} onPress={() => setPicking({ day: r.day, field: 'open' })} style={styles.time}>
                  <Text style={styles.timeText}>{timeLabel(r.open)}</Text>
                </Pressable>
                <Text style={styles.to}>to</Text>
                <Pressable accessibilityRole="button" accessibilityLabel={`${r.day} closing time`} onPress={() => setPicking({ day: r.day, field: 'close' })} style={styles.time}>
                  <Text style={styles.timeText}>{timeLabel(r.close)}</Text>
                </Pressable>
              </View>
            )}
            <Switch
              value={!r.closed}
              onValueChange={(on) => { setNote(''); apply((d) => setDay(d, r.day, { closed: !on })); }}
              trackColor={{ true: colors.accent, false: 'rgba(255,255,255,0.16)' }}
              accessibilityLabel={`${r.day} open`}
            />
          </View>
        ))}
        {note ? <Text style={styles.note}>{note}</Text> : null}
        <Pressable
          accessibilityRole="button"
          onPress={() => { setNote(''); apply((d) => copyDayToOpenDays(d, 'Tuesday')); }}
          style={styles.copy}
        >
          <Text style={styles.copyText}>Copy Tuesday to all open days</Text>
        </Pressable>
      </ScrollView>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { maxHeight: 460 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  day: { width: 92, fontFamily: fonts.bodySemi, fontSize: 14, color: '#fff' },
  closed: { flex: 1, fontFamily: fonts.body, fontSize: 14, color: 'rgba(255,255,255,0.45)' },
  times: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  time: { borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 8 },
  timeText: { fontFamily: fonts.bodySemi, fontSize: 13, color: '#fff' },
  to: { fontFamily: fonts.body, fontSize: 12, color: 'rgba(255,255,255,0.5)' },
  note: { fontFamily: fonts.body, fontSize: 13, color: colors.danger, paddingTop: 10 },
  copy: { alignSelf: 'center', paddingVertical: 14 },
  copyText: { fontFamily: fonts.bodyBold, fontSize: 12, letterSpacing: 1.2, textTransform: 'uppercase', color: colors.accent },
  option: { paddingVertical: 14, paddingHorizontal: 12, borderRadius: 8 },
  optionOn: { backgroundColor: 'rgba(244,161,0,0.14)' },
  optionText: { fontFamily: fonts.body, fontSize: 16, color: '#fff' },
  optionTextOn: { color: colors.accent, fontFamily: fonts.bodySemi },
  pressed: { opacity: 0.6 },
});
