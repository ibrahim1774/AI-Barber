import { useId } from 'react';
import { InputAccessoryView, Keyboard, Platform, Pressable, StyleSheet, Text, View, type KeyboardTypeOptions } from 'react-native';
import { colors, fonts } from '@/constants/theme';

/** The pads with no Return key: phone, number and decimal pads. They need a Done button to be dismissed. */
export const NO_RETURN_KEY: readonly KeyboardTypeOptions[] = ['phone-pad', 'number-pad', 'decimal-pad', 'numeric'];
export const needsDoneBar = (keyboardType?: KeyboardTypeOptions): boolean =>
  Platform.OS === 'ios' && keyboardType != null && NO_RETURN_KEY.includes(keyboardType);

/**
 * The iOS number pads have no Return key, so a field using one could never be left and the keyboard hid the button
 * below it. This is the bar above the pad with a Done button; the field points at it with inputAccessoryViewID.
 * Use `useDoneBar(keyboardType)` in the input component and render the returned element next to the TextInput.
 */
export function useDoneBar(keyboardType?: KeyboardTypeOptions): { id: string | undefined; bar: React.ReactElement | null } {
  const id = `done-${useId()}`;
  if (!needsDoneBar(keyboardType)) return { id: undefined, bar: null };
  return { id, bar: <KeyboardDoneBar id={id} /> };
}

export function KeyboardDoneBar({ id }: { id: string }) {
  return (
    <InputAccessoryView nativeID={id}>
      <View style={styles.bar}>
        <Pressable accessibilityRole="button" accessibilityLabel="Done" hitSlop={8} onPress={() => Keyboard.dismiss()} style={styles.btn}>
          <Text style={styles.text}>Done</Text>
        </Pressable>
      </View>
    </InputAccessoryView>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', justifyContent: 'flex-end', backgroundColor: '#1c1c1e',
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.18)', paddingHorizontal: 8,
  },
  btn: { paddingHorizontal: 14, paddingVertical: 10, minHeight: 44, justifyContent: 'center' },
  text: { fontFamily: fonts.bodyBold, fontSize: 16, color: colors.accent },
});
