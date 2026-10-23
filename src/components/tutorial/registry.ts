import { useEffect, useRef, type RefObject } from 'react';
import type { View } from 'react-native';

/** Where each target on screen is: refs registered by useTutorialTarget, measured when a step needs them. */
const targets = new Map<string, RefObject<View | null>>();

/**
 * Put the returned ref on the View (or Pressable) a tour step points at:
 * `const ref = useTutorialTarget('bookings.add'); <View ref={ref} collapsable={false}>`.
 */
export function useTutorialTarget(id: string): RefObject<View | null> {
  const ref = useRef<View | null>(null);
  useEffect(() => {
    targets.set(id, ref);
    return () => {
      if (targets.get(id) === ref) targets.delete(id);
    };
  }, [id]);
  return ref;
}

export interface Rect { x: number; y: number; width: number; height: number }

/** The target's rectangle in window coordinates, or null when it is not registered, unmounted or has no size. */
export function measureTarget(id: string | null): Promise<Rect | null> {
  return new Promise((resolve) => {
    const node = id ? targets.get(id)?.current : null;
    if (!node || typeof node.measureInWindow !== 'function') return resolve(null);
    let done = false;
    const finish = (r: Rect | null) => {
      if (!done) {
        done = true;
        resolve(r);
      }
    };
    // A view that never answers must not stall the tour.
    setTimeout(() => finish(null), 600);
    try {
      node.measureInWindow((x, y, width, height) => finish(width > 0 && height > 0 ? { x, y, width, height } : null));
    } catch {
      finish(null);
    }
  });
}

export function registeredTargets(): string[] {
  return [...targets.keys()];
}
