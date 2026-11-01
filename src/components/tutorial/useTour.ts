import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import {
  hasTourSeen, markTourSeen, TOURS, WEB_EDIT_STEPS, type Tour, type TourId, type TourScreen,
} from '@/components/tutorial/tours';

export interface TourController {
  tour: Tour | null;
  step: number;
  next(): void;
  skip(): void;
}

/**
 * A screen's tours. `auto` opens that tour by itself once the screen is `ready`, unless its seen flag is set
 * (`ignoreFlag` for the Edit tour, whose first-site timing is decided elsewhere). Finishing or skipping sets the flag and calls `onDone`.
 */
export function useTour(
  screen: TourScreen,
  opts: { auto?: TourId | null; ready?: boolean; ignoreFlag?: boolean; onDone?(id: TourId): void } = {},
): TourController {
  const { auto = null, ready = true, ignoreFlag = false, onDone } = opts;
  const [active, setActive] = useState<TourId | null>(null);
  const [step, setStep] = useState(0);
  const autoStarted = useRef<TourId | null>(null);
  const done = useRef(onDone);
  done.current = onDone;

  const start = useCallback((id: TourId) => {
    setStep(0);
    setActive(id);
  }, []);

  useEffect(() => {
    if (!auto || !ready || active || autoStarted.current === auto) return;
    autoStarted.current = auto;
    if (ignoreFlag) return start(auto);
    let alive = true;
    void hasTourSeen(auto).then((seen) => {
      if (alive && !seen) start(auto);
    });
    return () => {
      alive = false;
    };
  }, [auto, ready, active, ignoreFlag, start]);

  const finish = useCallback(() => {
    const id = active;
    setActive(null);
    if (!id) return;
    void markTourSeen(id);
    done.current?.(id);
  }, [active]);

  // Web: the Edit tour points at the controls a browser owner needs first (see WEB_EDIT_STEPS); the phone keeps its own steps.
  const tour = active ? (Platform.OS === 'web' && active === 'edit' ? { ...TOURS.edit, steps: WEB_EDIT_STEPS } : TOURS[active]) : null;
  const next = useCallback(() => {
    if (!tour) return;
    if (step + 1 >= tour.steps.length) finish();
    else setStep(step + 1);
  }, [tour, step, finish]);

  return { tour, step, next, skip: finish };
}
