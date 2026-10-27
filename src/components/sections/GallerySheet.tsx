import { useState } from 'react';
import { isStockImage } from '@/web/lib/stockImages';
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
  /** Applied to the editor's latest data, so it composes with concurrent changes. */
  onChange(update: (d: WebsiteData) => WebsiteData): void;
  onClose(): void;
  onDismiss?(): void;
  /** Picks and uploads one photo through the editor's upload guard; null if cancelled or dropped. */
  upload(onPicked?: () => void): Promise<string | null>;
}

export function GallerySheet({ visible, data, onChange, onClose, onDismiss, upload }: Props) {
  const pick = usePhotoPick(upload, (url, slot) => {
    onChange((d) => setGalleryPhoto(d, slot, url));
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
          onChange((d) => clearGalleryPhoto(d, slot));
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
        {gallerySlots(data).map((slot, n) => {
          const url = data.gallery?.[slot] ?? '';
          return (
            <Pressable
              key={slot}
              accessibilityRole="button"
              accessibilityLabel={url ? `${isStockImage(url) ? 'Sample photo' : 'Photo'} ${n + 1}: replace or remove` : 'Add photo'}
              onPress={() => tap(slot, url)}
              style={({ pressed }) => [styles.tile, pressed && { opacity: 0.7 }]}
            >
              {url ? <TileImage url={url} /> : <Text style={styles.add}>+ Add photo</Text>}
              {!!url && isStockImage(url) && <Text style={styles.sample}>Sample</Text>}
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

/** A saved photo whose link no longer loads (a hotlinked import can expire) keeps its slot and says so, never an empty tile. */
function TileImage({ url }: { url: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Text style={styles.add}>Photo unavailable. Tap to replace</Text>;
  return <Image source={{ uri: url }} style={styles.img} onError={() => setFailed(true)} />;
}

const styles = StyleSheet.create({
  scroll: { maxHeight: 420 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: {
    width: '31%', aspectRatio: 1, borderRadius: 10, overflow: 'hidden', alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)', borderStyle: 'dashed', backgroundColor: 'rgba(255,255,255,0.04)',
  },
  img: { width: '100%', height: '100%' },
  sample: {
    position: 'absolute', left: 6, bottom: 6, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, overflow: 'hidden',
    backgroundColor: 'rgba(0,0,0,0.7)', color: '#fff', fontFamily: fonts.bodyBold, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase',
  },
  add: { fontFamily: fonts.bodySemi, fontSize: 12, color: colors.accent, textAlign: 'center' },
  busy: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingTop: 12 },
  busyText: { fontFamily: fonts.body, fontSize: 13, color: 'rgba(255,255,255,0.7)' },
});
