import type { RefObject } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fonts } from '@/constants/theme';
import type { ImageRect } from '@/lib/previewBridge';
import { SAMPLE_HERO_NOTE } from '@/lib/pageHero';

/** Photo whose pill the Edit tour points at: the hero if it is on screen, else the first. */
export function tourPillPath(items: ImageRect[]): string | null {
  return (items.find((r) => r.path === 'hero.imageUrl') ?? items[0])?.path ?? null;
}

/**
 * A small "Change image" text chip at the bottom-left of every photo that is on screen (of its visible part).
 * Stationary and always rendered while the photo is on screen: it is never hidden for scrolling (the page
 * script streams fresh rectangles, so it follows the photo). Dark translucent, tiny; the tap area grows via
 * hitSlop only. `items` are the rectangles the page reported (previewBridge 'rects'), positions in the WebView.
 */
export function ChangeImagePills({
  items, hidden, onPress, tourRef, samplePaths,
}: {
  items: ImageRect[];
  /** True only when something covers the preview. */
  hidden: boolean;
  onPress(path: string): void;
  /** Registered with the tutorial on the tour's pill. */
  tourRef?: RefObject<View | null>;
  /** Photos that are still a sample: each shows a short prompt over its pill. Editor only, never on the site. */
  samplePaths?: string[];
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
          {samplePaths?.includes(r.path) && (
            <Text style={styles.sample} accessibilityRole="text">{SAMPLE_HERO_NOTE}</Text>
          )}
          <Pressable
            ref={r.path === tour ? tourRef : undefined}
            collapsable={false}
            accessibilityRole="button"
            accessibilityLabel="Change image"
            hitSlop={{ top: 16, bottom: 16, left: 14, right: 20 }}
            onPress={() => onPress(r.path)}
            style={({ pressed }) => [styles.pill, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.text}>Change image</Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  slot: { position: 'absolute', alignItems: 'flex-start', justifyContent: 'flex-end', padding: 6 },
  pill: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.55)' },
  text: { fontFamily: fonts.bodySemi, fontSize: 11, color: '#fff' },
  sample: {
    fontFamily: fonts.bodySemi, fontSize: 11, color: '#fff', marginBottom: 4, paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: 4, backgroundColor: 'rgba(0,0,0,0.55)', overflow: 'hidden',
  },
});
