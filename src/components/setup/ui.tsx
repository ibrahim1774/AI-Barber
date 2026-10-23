import { forwardRef, useId, useRef, type ReactNode } from 'react';
import { InputAccessoryView, Keyboard, Platform, Pressable, StyleSheet, Switch, Text, TextInput, View, type TextInputProps } from 'react-native';
import { colors, fonts } from '@/constants/theme';

/** The decimal and number keypads have no Return key; this bar above them gives them a Done. Rendered next to its input (a Modal is its own window). */
function NumericDoneBar({ id }: { id: string }) {
  if (Platform.OS !== 'ios') return null;
  return (
    <InputAccessoryView nativeID={id}>
      <View style={s.doneBar}>
        <Pressable onPress={() => Keyboard.dismiss()} hitSlop={8} accessibilityRole="button" accessibilityLabel="Done">
          <Text style={s.doneText}>Done</Text>
        </Pressable>
      </View>
    </InputAccessoryView>
  );
}

export function Card({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <View style={s.card}>
      {!!title && <Text style={s.cardTitle} accessibilityRole="header">{title}</Text>}
      {children}
    </View>
  );
}

export function Label({ children }: { children: string }) {
  return <Text style={s.label}>{children}</Text>;
}

export function Note({ children, tone }: { children: ReactNode; tone?: 'warn' | 'error' }) {
  return (
    <Text
      style={[s.note, tone === 'warn' && { color: colors.overlayGold }, tone === 'error' && { color: '#f87171' }]}
      accessibilityLiveRegion={tone === 'error' ? 'polite' : undefined}
    >
      {children}
    </Text>
  );
}

/**
 * A text input. With `title` it draws its own caption above it, and tapping the caption focuses the input
 * (the accessibility `label` stays on the input, so VoiceOver skips the caption).
 */
export const Input = forwardRef<TextInput, TextInputProps & { label: string; title?: string }>(function Input(props, ref) {
  const { label, title, ...rest } = props;
  const inner = useRef<TextInput | null>(null);
  const accessoryId = useId();
  const numeric = rest.keyboardType === 'decimal-pad' || rest.keyboardType === 'number-pad';
  const setRef = (node: TextInput | null) => {
    inner.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  };
  const input = (
    <>
    <TextInput
      ref={setRef}
      accessibilityLabel={label}
      placeholderTextColor="rgba(255,255,255,0.3)"
      selectionColor={colors.accent}
      inputAccessoryViewID={numeric ? accessoryId : undefined}
      {...rest}
      style={[s.input, rest.multiline && { minHeight: 64, textAlignVertical: 'top' }, rest.style]}
    />
    {numeric && <NumericDoneBar id={accessoryId} />}
    </>
  );
  if (!title) return input;
  return (
    <View style={{ gap: 10 }}>
      <Text onPress={() => inner.current?.focus()} importantForAccessibility="no" accessibilityElementsHidden style={s.label}>
        {title}
      </Text>
      {input}
    </View>
  );
});

export function Chip({ label, selected, onPress }: { label: string; selected?: boolean; onPress(): void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={({ pressed }) => [s.chip, selected && s.chipOn, pressed && { opacity: 0.6 }]}
    >
      <Text style={[s.chipText, selected && { color: colors.buttonInk }]}>{label}</Text>
    </Pressable>
  );
}

export function Chips({ children }: { children: ReactNode }) {
  return <View style={s.chips}>{children}</View>;
}

export function ToggleRow({
  label, detail, value, onValueChange, disabled,
}: { label: string; detail?: string; value: boolean; onValueChange(v: boolean): void; disabled?: boolean }) {
  return (
    <View style={s.toggle}>
      {/* Tapping the text flips the switch, like a row in Settings. The Switch carries the accessibility label. */}
      <Pressable
        style={{ flex: 1 }}
        disabled={disabled}
        onPress={() => onValueChange(!value)}
        importantForAccessibility="no"
        accessibilityElementsHidden
      >
        <Text style={s.toggleLabel}>{label}</Text>
        {!!detail && <Text style={s.toggleDetail}>{detail}</Text>}
      </Pressable>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        accessibilityLabel={label}
        trackColor={{ true: colors.accent, false: 'rgba(255,255,255,0.18)' }}
      />
    </View>
  );
}

export function Row({ label, detail, onPress }: { label: string; detail?: string; onPress(): void }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [s.row, pressed && { opacity: 0.6 }]}
    >
      <View style={{ flex: 1 }}>
        <Text style={s.toggleLabel}>{label}</Text>
        {!!detail && <Text style={s.toggleDetail} numberOfLines={2}>{detail}</Text>}
      </View>
      <Text style={s.chev}>›</Text>
    </Pressable>
  );
}

/** Small text action (Edit, Remove, Copy). */
export function TextAction({ title, onPress, danger, disabled }: { title: string; onPress(): void; danger?: boolean; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [{ paddingVertical: 8, paddingHorizontal: 6, opacity: disabled ? 0.4 : pressed ? 0.6 : 1 }]}
    >
      <Text style={[s.action, danger && { color: colors.danger }]}>{title}</Text>
    </Pressable>
  );
}

export function Stepper({
  value, onMinus, onPlus, label,
}: { value: string; onMinus(): void; onPlus(): void; label: string }) {
  return (
    <View style={s.stepper} accessibilityLabel={label}>
      <Pressable onPress={onMinus} hitSlop={6} accessibilityRole="button" accessibilityLabel={`${label} earlier`} style={s.stepBtn}>
        <Text style={s.stepGlyph}>−</Text>
      </Pressable>
      <Text style={s.stepValue}>{value}</Text>
      <Pressable onPress={onPlus} hitSlop={6} accessibilityRole="button" accessibilityLabel={`${label} later`} style={s.stepBtn}>
        <Text style={s.stepGlyph}>+</Text>
      </Pressable>
    </View>
  );
}

export const s = StyleSheet.create({
  doneBar: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 16, paddingVertical: 10, backgroundColor: '#1c1c1e' },
  doneText: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.accent },
  card: {
    borderRadius: 14, borderWidth: 1, borderColor: colors.hair, backgroundColor: 'rgba(255,255,255,0.04)',
    padding: 16, marginBottom: 16, gap: 10,
  },
  cardTitle: { fontFamily: fonts.heading, fontSize: 16, color: colors.heading },
  label: {
    fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.6, textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.5)', marginTop: 6,
  },
  note: { fontFamily: fonts.body, fontSize: 13, lineHeight: 19, color: colors.muted },
  input: {
    fontFamily: fonts.body, fontSize: 16, lineHeight: 22, color: '#fff',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10,
  },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    paddingHorizontal: 14, paddingVertical: 10, borderRadius: 999,
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)', backgroundColor: 'rgba(255,255,255,0.05)',
  },
  chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { fontFamily: fonts.bodySemi, fontSize: 14, color: '#fff' },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 44 },
  toggleLabel: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.text },
  toggleDetail: { fontFamily: fonts.body, fontSize: 12, lineHeight: 17, color: colors.muted, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 52, paddingVertical: 6 },
  chev: { fontSize: 22, color: colors.faint },
  action: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.accent },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  stepBtn: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.08)' },
  stepGlyph: { fontFamily: fonts.bodyBold, fontSize: 18, color: colors.accent },
  stepValue: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.text, minWidth: 74, textAlign: 'center' },
});
