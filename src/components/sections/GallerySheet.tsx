import { useRef } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { WebsiteData } from '@/web/types';
import { colors, fonts } from '@/constants/theme';
import { track } from '@/lib/analytics';
import { Sheet, SheetAction } from '@/components/EditSheet';
import { clearGalleryPhoto, gallerySlots, setGalleryPhoto } from '@/lib/sections/gallery';
import { usePhotoPick } from '@/components/sections/usePhotoPick';

interface Props {
  visible: boolean;
  data: WebsiteData;
  onChange(next: WebsiteData): void;
  onClose(): void;
  onDismiss?(): void;
}

export function GallerySheet({ visible, data, onChange, onClose, onDismiss }: Props) {
  const dataRef = useRef(data);
  dataRef.current = data;

  const pick = usePhotoPick('gallery', (url, slot) => {
    onChange(setGalleryPhoto(dataRef.current, slot, url));
    track('section_saved', { section: 'gallery' });
  });

  const tap = (slot: number, url: string) => {
    if (pick.busy) return;
    if (!url) { pick.start(slot); return; }
    Alert.alert('Photo', undefined, [
      { text: 'Replace', onPress: () => pick.start(slot) },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => {
          onChange(clearGalleryPhoto(dataRef.current, slot));
          track('section_saved', { section: 'gallery' });
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  return (
    <Sheet
      visible={visible && !pick.hidden}
      title="Gallery"
      onClose={onClose}
      onDismiss={() => pick.onDismiss(onDismiss)}
      right={<SheetAction title="Done" primary onPress={onClose} />}
    >
      <ScrollView style={styles.scroll} contentContainerStyle={styles.grid}>
        {gallerySlots(data).map((slot) => {
          const url = data.gallery?.[slot] ?? '';
          return (
            <Pressable
              key={slot}
              accessibilityRole="button"
              accessibilityLabel={url ? `Photo ${slot}: replace or remove` : 'Add photo'}
              onPress={() => tap(slot, url)}
              style={({ pressed }) => [styles.tile, pressed && { opacity: 0.7 }]}
            >
              {url ? <Image source={{ uri: url }} style={styles.img} /> : <Text style={styles.add}>+ Add photo</Text>}
            </Pressable>
          );
        })}
      </ScrollView>
      {pick.busy ? (
        <View style={styles.busy}><ActivityIndicator color={colors.accent} /><Text style={styles.busyText}>Uploading photo</Text></View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  scroll: { maxHeight: 420 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    width: '31%', aspectRatio: 1, borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', borderStyle: 'dashed', backgroundColor: 'rgba(255,255,255,0.04)',
  },
  img: { width: '100%', height: '100%' },
  add: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.accent, textAlign: 'center' },
  busy: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingTop: 12 },
  busyText: { fontFamily: fonts.body, fontSize: 13, color: 'rgba(255,255,255,0.7)' },
});
