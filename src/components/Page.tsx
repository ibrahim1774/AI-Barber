import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts } from '@/constants/theme';
import { ChevronLeftIcon } from '@/components/Icons';

/** iOS adjusts the scroll insets natively (automaticallyAdjustKeyboardInsets); Android keeps the padding behaviour. */
export const KEYBOARD_AVOIDING: 'padding' | undefined = Platform.OS === 'ios' ? undefined : 'padding';

/**
 * The account screens' shell (Settings, sign in / up): #0d0d0d,
 * a header with an optional back chevron, the title as written (no caps:
 * /support quotes these names), an optional right action, scrolling content.
 */
export function Page({
  title, onBack, backLabel = 'Back', right, children,
}: {
  title: string;
  onBack?: () => void;
  backLabel?: string;
  right?: ReactNode;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.header}>
        <View style={styles.side}>
          {onBack && (
            <Pressable onPress={onBack} hitSlop={12} accessibilityRole="button" accessibilityLabel={backLabel}>
              <ChevronLeftIcon size={24} color={colors.text} />
            </Pressable>
          )}
        </View>
        <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
          {title}
        </Text>
        <View style={[styles.side, styles.right]}>{right}</View>
      </View>
      {/* iOS: the scroll view moves its own insets with the keyboard (native, no JS relayout while the keyboard changes
          type or height: a KeyboardAvoidingView re-laid-out the whole form each time and made it shake). */}
      <KeyboardAvoidingView behavior={KEYBOARD_AVOIDING} style={styles.flex}>
        <ScrollView
          keyboardShouldPersistTaps="handled"
          automaticallyAdjustKeyboardInsets
          contentContainerStyle={[styles.content, { paddingBottom: 32 + insets.bottom }]}
        >
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  header: {
    height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.hair,
  },
  side: { width: 44, justifyContent: 'center' },
  right: { alignItems: 'flex-end' },
  title: { flex: 1, textAlign: 'center', fontFamily: fonts.heading, fontSize: 17, color: colors.heading },
  content: { paddingHorizontal: 20, paddingTop: 24 },
});
