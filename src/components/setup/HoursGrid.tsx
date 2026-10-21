import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import {
  WEEKDAYS, copyToAll, defaultWeek, minutesLabel, rowsToWeek, setDay, stepEnd, stepStart, toggleDay, weekProblem, weekToRows,
  type DayHours,
} from '@/lib/setup/availability';
import { listAvailability, saveAvailability } from '@/lib/shop';
import { Note, Stepper, TextAction, ToggleRow } from '@/components/setup/ui';

/** Seven days: open switch, opening and closing time in 30-minute steps. */
export function HoursGrid({ week, onChange }: { week: DayHours[]; onChange(w: DayHours[]): void }) {
  return (
    <View>
      {week.map((d, i) => (
        <View key={WEEKDAYS[i]} style={st.day}>
          <ToggleRow label={WEEKDAYS[i]} value={d.open} onValueChange={() => onChange(toggleDay(week, i))} />
          {d.open && (
            <View style={st.times}>
              <Stepper
                label={`${WEEKDAYS[i]} opens`}
                value={minutesLabel(d.startMin)}
                onMinus={() => onChange(setDay(week, i, stepStart(d, -1)))}
                onPlus={() => onChange(setDay(week, i, stepStart(d, 1)))}
              />
              <Text style={st.to}>to</Text>
              <Stepper
                label={`${WEEKDAYS[i]} closes`}
                value={minutesLabel(d.endMin)}
                onMinus={() => onChange(setDay(week, i, stepEnd(d, -1)))}
                onPlus={() => onChange(setDay(week, i, stepEnd(d, 1)))}
              />
              <TextAction title="Copy to all" onPress={() => onChange(copyToAll(week, i))} />
            </View>
          )}
        </View>
      ))}
    </View>
  );
}

/** One barber's weekly hours, loaded from and saved to ab_availability. */
export function MemberHours({
  memberId, onSaved, saveLabel = 'Save hours', autoSaveRef,
}: {
  memberId: string;
  onSaved?(): void;
  saveLabel?: string;
  /** Lets a parent (the wizard's Continue) save without a button press. */
  autoSaveRef?: { current: (() => Promise<boolean>) | null };
}) {
  const [week, setWeek] = useState<DayHours[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    let alive = true;
    setWeek(null);
    listAvailability(memberId)
      .then((rows) => alive && setWeek(rows.length ? rowsToWeek(rows) : defaultWeek()))
      .catch(() => alive && setWeek(defaultWeek()));
    return () => { alive = false; };
  }, [memberId]);

  const save = useCallback(async (): Promise<boolean> => {
    if (!week) return false;
    const problem = weekProblem(week);
    if (problem) {
      Alert.alert(problem);
      return false;
    }
    setBusy(true);
    try {
      await saveAvailability(memberId, weekToRows(week));
      setDirty(false);
      onSaved?.();
      return true;
    } catch (e) {
      Alert.alert("Couldn't save your hours", e instanceof Error ? e.message : 'Try again.');
      return false;
    } finally {
      setBusy(false);
    }
  }, [week, memberId, onSaved]);

  useEffect(() => {
    if (autoSaveRef) autoSaveRef.current = async () => (dirty ? save() : true);
    return () => { if (autoSaveRef) autoSaveRef.current = null; };
  }, [autoSaveRef, save, dirty]);

  if (!week) return <ActivityIndicator color={colors.accent} style={{ marginVertical: 24 }} />;
  return (
    <View>
      <HoursGrid week={week} onChange={(w) => { setWeek(w); setDirty(true); }} />
      <Note>Customers can only book inside these hours. Time off and breaks are in the Bookings tab.</Note>
      <Button title={saveLabel} size="sm" onPress={() => void save()} loading={busy} style={{ marginTop: 12 }} />
    </View>
  );
}

const st = StyleSheet.create({
  day: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hair, paddingVertical: 4 },
  times: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6, paddingBottom: 8 },
  to: { fontFamily: fonts.body, fontSize: 13, color: colors.muted },
});
