import { useEffect, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { measureTarget, type Rect } from '@/components/tutorial/registry';
import type { TourController } from '@/components/tutorial/useTour';
import { clampHole, placeTip, CARD_MIN } from '@/components/tutorial/place';

const PAD = 6;
const DIM = 'rgba(5,7,10,0.78)';

/**
 * The coach marks for a running tour: a dim backdrop with a spotlight on the step's target, an arrow, a one-line
 * tip, step dots and Next / Skip. With no target (or one that cannot be measured) the tip is centred. Next and
 * Skip are always reachable, so a missing target can never trap the user.
 */
export function TutorialLayer({ controller }: { controller: TourController }) {
  const { tour, step, next, skip } = controller;
  const win = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [cardH, setCardH] = useState(CARD_MIN);
  const [rect, setRect] = useState<Rect | null>(null);
  const [measured, setMeasured] = useState(false);
  const s = tour?.steps[step];

  useEffect(() => {
    let alive = true;
    setMeasured(false);
    setRect(null);
    if (!tour || !s) return;
    // Let the screen settle (a sheet closing, the tab bar hiding) before measuring.
    const t = setTimeout(() => {
      void measureTarget(s.target).then((r) => {
        if (!alive) return;
        setRect(r);
        setMeasured(true);
      });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [tour, step, s]);

  if (!tour || !s) return null;
  const last = step + 1 >= tour.steps.length;
  const raw = rect
    ? {
        x: Math.max(0, rect.x - PAD), y: Math.max(0, rect.y - PAD),
        w: Math.min(win.width, rect.width + PAD * 2), h: rect.height + PAD * 2,
      }
    : null;
  // A target taller than the window is clipped to what is visible; one fully off screen counts as no target.
  const hole = raw ? clampHole(raw, win.width, win.height, insets) : null;
  const tip = placeTip(hole, win.width, win.height, insets, cardH);

  return (
    <Modal transparent visible animationType="fade" statusBarTranslucent onRequestClose={skip}>
      <View style={styles.root} accessibilityViewIsModal>
        {hole ? (
          <>
            <View style={[styles.dim, { top: 0, left: 0, right: 0, height: hole.y }]} />
            <View style={[styles.dim, { top: hole.y + hole.h, left: 0, right: 0, bottom: 0 }]} />
            <View style={[styles.dim, { top: hole.y, left: 0, width: hole.x, height: hole.h }]} />
            <View style={[styles.dim, { top: hole.y, left: hole.x + hole.w, right: 0, height: hole.h }]} />
            <View
              pointerEvents="none"
              style={[styles.ring, { top: hole.y, left: hole.x, width: hole.w, height: hole.h }]}
            />
          </>
        ) : (
          <View style={[styles.dim, StyleSheet.absoluteFill]} />
        )}
        {/* Tapping the dim area ends the tour, so a stuck user always has a way out. */}
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={next}
          accessibilityRole="button"
          accessibilityLabel="Dismiss tour"
        />
        <Pressable
          onPress={skip}
          hitSlop={10}
          style={[styles.close, { top: insets.top + 8 }]}
          accessibilityRole="button"
          accessibilityLabel="Close tour"
        >
          <Text style={styles.closeText}>✕</Text>
        </Pressable>
        {(measured || !s.target) && (
          <View
            onLayout={(e) => {
              const h = Math.round(e.nativeEvent.layout.height);
              if (h > 0 && Math.abs(h - cardH) > 1) setCardH(h);
            }}
            style={[
              styles.cardWrap,
              tip.centred
                ? styles.centred
                : tip.pinned ? { bottom: win.height - tip.edge }
                : tip.above ? { bottom: win.height - tip.edge } : { top: tip.edge },
            ]}
            pointerEvents="box-none"
          >
            {!tip.centred && !tip.above && !tip.pinned && hole && <Arrow x={hole.x + hole.w / 2} up />}
            <View style={styles.card} accessibilityLiveRegion="polite">
              <Text style={styles.tip}>{s.tip}</Text>
              <View style={styles.foot}>
                <View style={styles.dots} accessibilityLabel={`Step ${step + 1} of ${tour.steps.length}`}>
                  {tour.steps.map((_, i) => (
                    <View key={i} style={[styles.dot, i === step && styles.dotOn]} />
                  ))}
                </View>
                <View style={styles.btns}>
                  {!last && (
                    <Pressable onPress={skip} hitSlop={10} accessibilityRole="button" accessibilityLabel="Skip tour">
                      <Text style={styles.skip}>Skip</Text>
                    </Pressable>
                  )}
                  <Pressable onPress={next} accessibilityRole="button" style={styles.next}>
                    <Text style={styles.nextText}>{last ? 'Done' : 'Next'}</Text>
                  </Pressable>
                </View>
              </View>
            </View>
            {!tip.centred && tip.above && !tip.pinned && hole && <Arrow x={hole.x + hole.w / 2} up={false} />}
          </View>
        )}
        {/* Keep the controls reachable while the target is still being measured. */}
      </View>
    </Modal>
  );
}

/** A small triangle at horizontal position x (window coordinates) pointing at the target. */
function Arrow({ x, up }: { x: number; up: boolean }) {
  return (
    <View
      pointerEvents="none"
      style={[
        styles.arrowBase,
        up ? styles.arrowUp : styles.arrowDown,
        { left: x - 10 },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  dim: { position: 'absolute', backgroundColor: DIM },
  ring: { position: 'absolute', borderRadius: 14, borderWidth: 2, borderColor: colors.accent },
  cardWrap: { position: 'absolute', left: 0, right: 0, paddingHorizontal: 16 },
  centred: { top: 0, bottom: 0, justifyContent: 'center' },
  card: {
    backgroundColor: colors.sheet, borderRadius: 16, padding: 16, borderWidth: 1, borderColor: colors.hair,
    gap: 14,
  },
  tip: { fontFamily: fonts.bodySemi, fontSize: 15, lineHeight: 21, color: colors.text },
  foot: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dots: { flexDirection: 'row', gap: 6 },
  dot: { width: 7, height: 7, borderRadius: 4, backgroundColor: 'rgba(237,239,244,0.25)' },
  dotOn: { backgroundColor: colors.accent },
  btns: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  skip: { fontFamily: fonts.bodySemi, fontSize: 14, color: colors.muted },
  next: { backgroundColor: colors.accent, borderRadius: 999, paddingHorizontal: 20, paddingVertical: 9 },
  nextText: { fontFamily: fonts.bodyBold, fontSize: 14, color: colors.accentInk },
  close: {
    position: 'absolute', right: 16, width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center',
    backgroundColor: 'rgba(237,239,244,0.16)',
  },
  closeText: { fontFamily: fonts.bodyBold, fontSize: 15, color: colors.text },
  arrowBase: {
    position: 'absolute', width: 0, height: 0, borderLeftWidth: 10, borderRightWidth: 10,
    borderLeftColor: 'transparent', borderRightColor: 'transparent',
  },
  arrowUp: { top: -9, borderBottomWidth: 10, borderBottomColor: colors.sheet },
  arrowDown: { bottom: -9, borderTopWidth: 10, borderTopColor: colors.sheet },
});
