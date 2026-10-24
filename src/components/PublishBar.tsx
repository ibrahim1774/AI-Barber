import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts } from '@/constants/theme';
import { ArrowRight } from '@/components/Icons';
import { useTutorialTarget } from '@/components/tutorial/registry';

/**
 * The editor's tool bar (the web's EditorToolbar, minus Save — every change
 * saves). It sits above the tab bar; "Text" (the web's Edit) so the screen
 * doesn't show two "Edit" buttons. padBottom: clear the home indicator when
 * the tab bar is hidden.
 */
export function PublishBar({
  onPages, onSections, onText, onPhotos, onPublish, disabled, padBottom = true,
}: {
  onPages(): void;
  onSections(): void;
  onText(): void;
  onPhotos(): void;
  onPublish(): void;
  disabled?: boolean;
  padBottom?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const publishRef = useTutorialTarget('edit.publish');
  return (
    <View style={[styles.bar, { paddingBottom: 10 + (padBottom ? insets.bottom : 0) }]}>
      <Tool target="edit.pages" title="Pages" hint="Pick, add, hide and reorder pages" onPress={onPages} disabled={disabled} />
      <Tool target="edit.sections" title="Sections" hint="Services, team, hours and more" onPress={onSections} disabled={disabled} />
      <Tool target="edit.text" title="Text" hint="All text fields" onPress={onText} disabled={disabled} />
      <Tool target="edit.photos" title="Photos" onPress={onPhotos} disabled={disabled} />
      <Pressable
        ref={publishRef}
        collapsable={false}
        accessibilityRole="button"
        accessibilityState={{ disabled: !!disabled }}
        onPress={onPublish}
        disabled={disabled}
        style={({ pressed }) => [styles.publish, (pressed || disabled) && { opacity: 0.7 }]}
      >
        <Text style={styles.publishText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>Publish</Text>
        <ArrowRight size={11} color={colors.buttonInk} />
      </Pressable>
    </View>
  );
}

function Tool({ target, title, hint, onPress, disabled }: { target: string; title: string; hint?: string; onPress(): void; disabled?: boolean }) {
  const ref = useTutorialTarget(target);
  return (
    <Pressable
      ref={ref}
      collapsable={false}
      accessibilityRole="button"
      accessibilityHint={hint}
      accessibilityState={{ disabled: !!disabled }}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [styles.tool, (pressed || disabled) && { opacity: 0.6 }]}
    >
      <Text style={styles.toolText} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.8}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingHorizontal: 6, paddingTop: 10,
    backgroundColor: '#111111', borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)',
  },
  tool: {
    flex: 1, alignItems: 'center', paddingVertical: 12, paddingHorizontal: 2, borderRadius: 6,
    backgroundColor: 'rgba(255,255,255,0.1)',
  },
  toolText: { fontFamily: fonts.bodyExtra, fontSize: 10, letterSpacing: 0.5, textTransform: 'uppercase', color: '#fff' },
  publish: {
    flex: 1.2, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    paddingVertical: 12, borderRadius: 6, backgroundColor: colors.accent,
  },
  publishText: { fontFamily: fonts.headingBlack, fontSize: 10.5, letterSpacing: 1, textTransform: 'uppercase', color: colors.buttonInk },
});
