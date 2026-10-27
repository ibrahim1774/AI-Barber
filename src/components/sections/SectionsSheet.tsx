import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import type { WebsiteData } from '@/web/types';
import { colors, fonts } from '@/constants/theme';
import { Sheet, SheetAction } from '@/components/EditSheet';
import { sectionCards, type SectionKey } from '@/lib/sections/list';

/** The list of site sections; tapping a card opens that section's editor. */
export function SectionsSheet({
  visible, data, onOpen, onLogo, previewUri, onClose, onDismiss,
}: {
  visible: boolean;
  data: WebsiteData;
  onOpen(key: SectionKey): void;
  /** Opens the logo flow (the header sheet's Logo pane). Omitted while the logo feature is off: no row. */
  onLogo?(): void;
  /** The just-uploaded logo as a data URI (shown at once); else the saved URL. */
  previewUri?: string | null;
  onClose(): void;
  onDismiss?(): void;
}) {
  return (
    <Sheet visible={visible} title="Sections" onClose={onClose} onDismiss={onDismiss}>
      <View style={styles.list}>
        {sectionCards(data).map((c) => (
          <Pressable
            key={c.key}
            accessibilityRole="button"
            accessibilityLabel={`${c.title}, ${c.summary}`}
            onPress={() => onOpen(c.key)}
            style={({ pressed }) => [styles.card, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.title}>{c.title}</Text>
            <Text style={styles.summary} numberOfLines={1}>{c.summary}</Text>
          </Pressable>
        ))}
        {onLogo && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Logo, ${data.logo ? 'Change or remove' : 'Add'}`}
            onPress={onLogo}
            style={({ pressed }) => [styles.card, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.title}>Logo</Text>
            <View style={styles.logoRight}>
              <Text style={styles.summary} numberOfLines={1}>{data.logo ? 'Change or remove' : 'Add'}</Text>
              {data.logo?.url ? (
                <Image source={{ uri: previewUri || data.logo.url }} style={styles.thumb} resizeMode="contain" />
              ) : (
                <View style={[styles.thumb, styles.thumbEmpty]}><Text style={styles.plus}>+</Text></View>
              )}
            </View>
          </Pressable>
        )}
      </View>
      <SheetAction title="Done" onPress={onClose} />
    </Sheet>
  );
}

const styles = StyleSheet.create({
  list: { gap: 8, marginBottom: 8 },
  card: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    paddingHorizontal: 14, paddingVertical: 14, borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  title: { fontFamily: fonts.bodyBold, fontSize: 15, color: '#fff' },
  logoRight: { flexDirection: 'row', alignItems: 'center', gap: 10, flexShrink: 1 },
  thumb: { width: 44, height: 28 },
  thumbEmpty: { alignItems: 'center', justifyContent: 'center', borderRadius: 6, borderWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,0.3)' },
  plus: { fontFamily: fonts.bodyBold, fontSize: 16, color: 'rgba(255,255,255,0.7)' },
  summary: { flexShrink: 1, fontFamily: fonts.body, fontSize: 13, color: 'rgba(255,255,255,0.55)' },
});
