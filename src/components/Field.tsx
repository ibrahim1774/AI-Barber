import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { straightenQuotes } from '@/lib/sections/text';
import { colors, fonts } from '@/constants/theme';
import { useDoneBar } from '@/components/KeyboardDoneBar';

export interface FieldProps extends Omit<TextInputProps, 'style' | 'placeholder'> {
  label: string;
  /**
   * 'card' = big ink input on the white import card; 'dark' = classic form;
   * 'form' = left-aligned underline input on the dark account screens.
   */
  tone?: 'card' | 'dark' | 'form';
  /** card only: example values typed out as an animated placeholder. */
  typeExamples?: readonly string[];
  placeholder?: string;
}

export const Field = forwardRef<TextInput, FieldProps>(function Field(
  { label, tone = 'card', typeExamples, placeholder, value, onFocus, onBlur, onChangeText, ...input },
  ref,
) {
  const [focused, setFocused] = useState(false);
  // Number pads have no Return key: a Done bar above them dismisses the keyboard.
  const done = useDoneBar(input.keyboardType);
  const inner = useRef<TextInput | null>(null);
  const setRef = useCallback((node: TextInput | null) => {
    inner.current = node;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  }, [ref]);
  const typed = useTypewriter(typeExamples ?? [], !!typeExamples?.length && !value);
  const card = tone === 'card';
  return (
    <View>
      {/* Tapping the label focuses the field. The input carries the accessibility label, so VoiceOver skips this one. */}
      <Text
        onPress={() => inner.current?.focus()}
        importantForAccessibility="no"
        accessibilityElementsHidden
        style={card ? styles.cardLabel : tone === 'form' ? styles.formLabel : styles.darkLabel}
      >
        {label}
      </Text>
      <View>
        <TextInput
          ref={setRef}
          inputAccessoryViewID={done.id}
          {...input}
          value={value}
          onChangeText={onChangeText && !input.secureTextEntry ? (t) => onChangeText(straightenQuotes(t)) : onChangeText}
          accessibilityLabel={input.accessibilityLabel ?? label}
          placeholder={card ? undefined : placeholder}
          placeholderTextColor="rgba(255,255,255,0.2)"
          selectionColor={card ? colors.ink : colors.accent}
          onFocus={(e) => { setFocused(true); onFocus?.(e); }}
          onBlur={(e) => { setFocused(false); onBlur?.(e); }}
          style={card ? styles.cardInput : tone === 'form' ? styles.formInput : styles.darkInput}
        />
        {done.bar}
        {card && !value && typeExamples && (
          <View pointerEvents="none" style={styles.typedWrap}>
            <Text numberOfLines={1} style={[styles.cardInput, styles.typed]}>
              {typed}
            </Text>
            <Caret />
          </View>
        )}
        <View
          style={[
            styles.line,
            card
              ? { backgroundColor: focused ? 'rgba(11,14,20,0.5)' : colors.inkLine }
              : { backgroundColor: focused ? colors.accent : 'rgba(255,255,255,0.4)' },
          ]}
        />
      </View>
    </View>
  );
});

function Caret() {
  const o = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const blink = Animated.loop(
      Animated.sequence([
        Animated.delay(500),
        Animated.timing(o, { toValue: 0, duration: 0, useNativeDriver: true }),
        Animated.delay(500),
        Animated.timing(o, { toValue: 1, duration: 0, useNativeDriver: true }),
      ]),
    );
    blink.start();
    return () => blink.stop();
  }, [o]);
  return <Animated.View style={[styles.caret, { opacity: o }]} />;
}

/**
 * Self-typing placeholder (GbpImportPage TYPE_LINKS / TYPE_NAMES): types a
 * word, holds 1.6 s, deletes two chars at a time, moves on. A self-scheduling
 * timeout chain, so it never depends on the typed string itself.
 */
function useTypewriter(examples: readonly string[], active: boolean): string {
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (!active || !examples.length) { setTyped(''); return; }
    let alive = true;
    let idx = 0, pos = 0, deleting = false;
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      if (!alive) return;
      const word = examples[idx % examples.length];
      if (!deleting) {
        pos += 1;
        setTyped(word.slice(0, pos));
        if (pos >= word.length) { deleting = true; t = setTimeout(tick, 1600); return; }
        t = setTimeout(tick, 34 + Math.random() * 40);
      } else {
        pos -= 2;
        if (pos <= 0) { pos = 0; deleting = false; idx += 1; setTyped(''); t = setTimeout(tick, 420); return; }
        setTyped(word.slice(0, pos));
        t = setTimeout(tick, 14);
      }
    };
    t = setTimeout(tick, 700);
    return () => { alive = false; clearTimeout(t); };
  }, [active, examples]);
  return typed;
}

const styles = StyleSheet.create({
  cardLabel: {
    fontFamily: fonts.bodyExtra, fontSize: 13, letterSpacing: 2.9, textTransform: 'uppercase',
    color: colors.ink, marginBottom: 12,
  },
  // clamp(1.35rem, 3.2vw, 1.9rem) → 21.6 px at 390 px, weight 600
  cardInput: {
    fontFamily: fonts.bodySemi, fontSize: 22, letterSpacing: -0.3, color: colors.ink,
    paddingTop: 0, paddingBottom: 16, paddingRight: 8,
  },
  typedWrap: { position: 'absolute', left: 0, right: 32, top: 0, flexDirection: 'row' },
  typed: { color: colors.inkPlaceholder, flexShrink: 1 },
  // The web sets --ta to the accent, so the card caret is gold.
  caret: { width: 2, height: 23, marginLeft: 2, marginTop: 2, backgroundColor: colors.accent },
  line: { position: 'absolute', left: 0, right: 0, bottom: 0, height: StyleSheet.hairlineWidth * 2 },
  darkLabel: {
    fontFamily: fonts.headingBlack, fontSize: 11, letterSpacing: 3, textTransform: 'uppercase',
    color: '#ffffff', textAlign: 'center', marginBottom: 4,
  },
  formLabel: {
    fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: colors.muted,
  },
  formInput: { fontFamily: fonts.body, fontSize: 16, color: '#ffffff', paddingTop: 10, paddingBottom: 12 },
  darkInput: {
    fontFamily: fonts.label, fontSize: 14, color: '#ffffff', textAlign: 'center', paddingVertical: 8,
  },
});
