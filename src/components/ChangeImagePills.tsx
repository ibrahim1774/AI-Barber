import type { RefObject } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fonts } from '@/constants/theme';
import { CameraIcon } from '@/components/Icons';
import type { ImageRect } from '@/lib/previewBridge';

/** Photo whose pill the Edit tour points at: the hero if it is on screen, else the first. */
export function tourPillPath(items: ImageRect[]): string | null {
  return (items.find((r) => r.path === 'hero.imageUrl') ?? items[0])?.path ?? null;
}

/**
 * A "Change image" pill on every photo that is on screen, bottom-right of its visible part. White 85% chip
 * with dark text so it reads on dark and light photos alike. `items` are the rectangles the page reported
 * (previewBridge 'rects'); they are positions in the WebView, which this layer sits exactly over.
 */
export function ChangeImagePills({
  items, hidden, onPress, tourRef,
}: {
  items: ImageRect[];
  /** True while the page scrolls: the pills would trail the photos. */
  hidden: boolean;
  onPress(path: string): void;
  /** Registered with the tutorial on the tour's pill. */
  tourRef?: RefObject<View | null>;
}) {
  if (hidden || items.length === 0) return null;
  const tour = tourPillPath(items);
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {items.map((r) => (
        <View
          key={r.path}
          pointerEvents="box-none"
          style={[styles.slot, { left: r.x, top: r.y, width: r.w, height: r.h }]}
        >
          <Pressable
            ref={r.path === tour ? tourRef : undefined}
            collapsable={false}
            accessibilityRole="button"
            accessibilityLabel="Change image"
            hitSlop={8}
            onPress={() => onPress(r.path)}
            style={({ pressed }) => [styles.pill, pressed && { opacity: 0.7 }]}
          >
            <CameraIcon size={14} color={INK} />
            <Text style={styles.text}>Change image</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const INK = '#111111';

const styles = StyleSheet.create({
  slot: { position: 'absolute', alignItems: 'flex-end', justifyContent: 'flex-end', padding: 8 },
  pill: {
    height: 28, flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.85)',
    shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 3,
  },
  text: { fontFamily: fonts.bodyBold, fontSize: 12, color: INK },
});
