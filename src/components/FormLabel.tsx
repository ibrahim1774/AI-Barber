import type { RefObject } from 'react';
import { Text, type StyleProp, type TextInput, type TextStyle } from 'react-native';

/**
 * A form label that behaves like one: tapping it focuses its input. The input
 * carries its own accessibility label, so VoiceOver skips the label text.
 */
export function FormLabel({ input, style, children }: { input: RefObject<TextInput | null>; style?: StyleProp<TextStyle>; children: string }) {
  return (
    <Text onPress={() => input.current?.focus()} importantForAccessibility="no" accessibilityElementsHidden style={style}>
      {children}
    </Text>
  );
}
