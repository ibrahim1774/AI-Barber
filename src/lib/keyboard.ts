import { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard, Platform, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollView, type View } from 'react-native';

/** The on-screen keyboard's height (0 when hidden). */
export function useKeyboardHeight(): number {
  const [h, setH] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => setH(e.endCoordinates?.height ?? 0));
    const hide = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide', () => setH(0));
    return () => { show.remove(); hide.remove(); };
  }, []);
  return h;
}

/** Height left for a sheet's scrolling body: 85% of the room above the keyboard, minus the sheet's own header and buttons. */
export function sheetBodyMaxHeight(windowHeight: number, keyboard: number): number {
  return Math.max(120, (windowHeight - keyboard) * 0.85 - 150);
}

/**
 * How far to scroll (positive = down) so a block at window-y `top` with `height`
 * ends `margin` above the keyboard, without pushing its top above `minTop`.
 */
export function revealDelta(o: { top: number; height: number; windowHeight: number; keyboard: number; minTop: number; margin?: number }): number {
  const margin = o.margin ?? 12;
  const bottom = o.windowHeight - o.keyboard - margin;
  const over = o.top + o.height - bottom;
  if (over <= 0) return 0;
  return Math.max(0, Math.min(over, o.top - o.minTop));
}

/**
 * Keeps a card usable above the keyboard on a Screen: whenever the keyboard is up (or `deps` change, e.g.
 * suggestions appear), scrolls the screen so the card's bottom clears the keyboard, as far as its top allows.
 * Pass `scrollRef` / `onScroll` to <Screen> and `cardRef` to the card's View.
 */
export function useRevealAboveKeyboard(deps: readonly unknown[], topInset = 60) {
  const scrollRef = useRef<ScrollView | null>(null);
  const cardRef = useRef<View | null>(null);
  const offset = useRef(0);
  const keyboard = useKeyboardHeight();
  const { height: windowHeight } = useWindowDimensions();
  const onScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => { offset.current = e.nativeEvent.contentOffset.y; }, []);
  useEffect(() => {
    if (!keyboard) return;
    const t = setTimeout(() => {
      cardRef.current?.measureInWindow((_x, top, _w, height) => {
        const d = revealDelta({ top, height, windowHeight, keyboard, minTop: topInset });
        if (d > 0) scrollRef.current?.scrollTo({ y: offset.current + d, animated: true });
      });
    }, 120);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyboard, windowHeight, topInset, ...deps]);
  return { scrollRef, cardRef, onScroll };
}
