import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fonts } from '@/constants/theme';
import { ArrowRight } from '@/components/Icons';

/** The editor's bottom bar (the web's EditorToolbar, minus Save — every change saves). */
export function PublishBar({
  onEdit, onPhotos, onColour, onPublish, disabled,
}: {
  onEdit(): void;
  onPhotos(): void;
  onColour(): void;
  onPublish(): void;
  disabled?: boolean;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: 10 + insets.bottom }]}>
      <Tool title="Edit" onPress={onEdit} disabled={disabled} />
      <Tool title="Photos" onPress={onPhotos} disabled={disabled} />
      <Tool title="Colour" onPress={onColour} disabled={disabled} />
      <Pressable
        accessibilityRole="button"
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

function Tool({ title, onPress, disabled }: { title: string; onPress(): void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
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
