import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { WebsiteData } from '@/web/types';
import { colors, fonts } from '@/constants/theme';
import { Sheet, SheetAction } from '@/components/EditSheet';
import { imageLabel } from '@/lib/editor';
import { getPath } from '@/lib/editable';
import { galleryChoices } from '@/lib/pageHero';

/**
 * Change image for a page's hero photo: one of the shop's own gallery photos first, a photo from the phone, or
 * the sample photo again (which clears the slot).
 */
export function HeroPhotoSheet({
  visible, data, path, onPhone, onGallery, onSample, onClose, onDismiss,
}: {
  visible: boolean;
  data: WebsiteData;
  path: string;
  onPhone(): void;
  onGallery(url: string): void;
  onSample(): void;
  onClose(): void;
  onDismiss?(): void;
}) {
  const own = typeof getPath(data, path) === 'string' && (getPath(data, path) as string).trim() !== '';
  const gallery = galleryChoices(data);
  return (
    <Sheet visible={visible} title={imageLabel(path, data)} onClose={onClose} onDismiss={onDismiss}>
      {gallery.length > 0 && (
        <>
          <Text style={styles.group}>From your gallery</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
            {gallery.map((u, i) => (
              <Pressable key={u} accessibilityRole="button" accessibilityLabel={`Use gallery photo ${i + 1}`} onPress={() => onGallery(u)}>
                <Image source={{ uri: u }} style={styles.thumb} resizeMode="cover" />
              </Pressable>
            ))}
          </ScrollView>
        </>
      )}
      <View style={styles.actions}>
        <SheetAction primary title="Choose from your phone" onPress={onPhone} />
        {own && <SheetAction title="Use sample photo" onPress={onSample} />}
        <SheetAction title="Cancel" onPress={onClose} />
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  group: {
    fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 2, textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)', marginBottom: 8,
  },
  strip: { gap: 10, paddingBottom: 12 },
  thumb: { width: 88, height: 88, borderRadius: 8, backgroundColor: '#1f1f1f', borderWidth: 1, borderColor: colors.accent },
  actions: { gap: 6, alignItems: 'center' },
});
