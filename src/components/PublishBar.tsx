import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts } from '@/constants/theme';
import { ArrowRight } from '@/components/Icons';

/**
 * The editor's tool bar (the web's EditorToolbar, minus Save — every change
 * saves). It sits above the tab bar; "Text" (the web's Edit) so the screen
 * doesn't show two "Edit" buttons. padBottom: clear the home indicator when
 * the tab bar is hidden.
 */
export function PublishBar({
  onText, onPhotos, onColour, onPublish, disabled, padBottom = true,
}: {
  onText(): void;
  onPhotos(): void;
  onColour(): void;
  onPublish(): void;
  disabled?: boolean;
  padBottom?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: 10 + (padBottom ? insets.bottom : 0) }]}>
      <Tool title="Text" hint="All text fields" onPress={onText} disabled={disabled} />
      <Tool title="Photos" onPress={onPhotos} disabled={disabled} />
      <Tool title="Colour" onPress={onColour} disabled={disabled} />
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: !!disabled }}
        onPress={onPublish}
        disabled={disabled}
        style={({ pressed }) => [styles.publish, (pressed || disabled) && { opacity: 0.7 }]}
      >
        <Text style={styles.publishText}>Publish</Text>
        <ArrowRight size={13} color={colors.buttonInk} />
      </Pressable>
    </View>
  );
}

function Tool({ title, hint, onPress, disabled }: { title: string; hint?: string; onPress(): void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.tool, (pressed || disabled) && { opacity: 0.6 }]}
    >
      <Text style={styles.toolText}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 12, paddingTop: 10,
    backgroundColor: '#111111', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)',
  },
  tool: {
    flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  toolText: { fontFamily: fonts.bodyExtra, fontSize: 11, letterSpacing: 1.2, textTransform: 'uppercase', color: '#fff' },
  publish: {
    flex: 1.4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    paddingVertical: 12, borderRadius: 6, backgroundColor: colors.accent,
  },
  publishText: { fontFamily: fonts.headingBlack, fontSize: 11, letterSpacing: 1.5, textTransform: 'uppercase', color: colors.buttonInk },
});
