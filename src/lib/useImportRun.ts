import { useEffect, useRef, useState } from 'react';
import { Keyboard } from 'react-native';
import { router, type Href } from 'expo-router';
import type { ShopInputs, WebsiteData } from '@/web/types';
import { startDraft } from '@/lib/flow';

type ShopSite = { inputs: ShopInputs; site: WebsiteData };

/** Run ids: a newer run, or leaving the screen, makes older runs stale. */
export function createRunGuard() {
  let current = 0;
  return {
    next: () => ++current,
    isCurrent: (id: number) => id === current,
    cancel: () => { current += 1; },
  };
}
export type RunGuard = ReturnType<typeof createRunGuard>;

export interface RunHooks {
  onReady(): void; // snap the bar to 100%
  onFail(message: string): void;
  save(result: ShopSite): Promise<unknown>;
  navigate(): void;
  wait(ms: number): Promise<void>;
}

/**
 * The web's runScrape/finishAndGo sequence without UI state: on success snap
 * to 100%, pause 150 ms, save the draft, then move on — re-checking the run
 * after every await so a stale run (newer run, or the screen was left)
 * never saves, navigates or reports.
 */
export async function runImport(guard: RunGuard, work: () => Promise<ShopSite>, hooks: RunHooks): Promise<void> {
  const runId = guard.next();
  try {
    const result = await work();
    if (!guard.isCurrent(runId)) return;
    hooks.onReady();
    await hooks.wait(150);
    if (!guard.isCurrent(runId)) return;
    await hooks.save(result);
    if (!guard.isCurrent(runId)) return;
    hooks.navigate();
  } catch (err: any) {
    if (!guard.isCurrent(runId)) return;
    hooks.onFail(err?.message || 'Something went wrong — try again.');
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Import staging for the importer screens: the bar eases toward the scrape
 * ceiling (92%) while the request runs, snaps to 100% when the site is ready,
 * then the draft is saved and the app moves to /generating. A slow hint shows
 * after 15 s. Ignores a second start while one is running.
 */
export function useImportRun() {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [slowHint, setSlowHint] = useState(false);
  const capRef = useRef(0);
  const busyRef = useRef(false);
  const guardRef = useRef<RunGuard | null>(null);
  if (!guardRef.current) guardRef.current = createRunGuard();

  useEffect(() => () => guardRef.current?.cancel(), []);

  useEffect(() => {
    if (!busy) { setProgress(0); capRef.current = 0; return; }
    const timer = setInterval(() => {
      setProgress((p) => {
        const cap = capRef.current;
        if (p >= cap) return p;
        return Math.min(cap, p + Math.max(0.015, (cap - p) * 0.02));
      });
    }, 120);
    return () => clearInterval(timer);
  }, [busy]);

  /** `to`: where the saved draft goes next. Imports pass the review screen; the typed form goes straight to /generating. */
  const run = async (work: () => Promise<ShopSite>, onFail: (message: string) => void, to: Href = '/generating') => {
    if (busyRef.current) return;
    busyRef.current = true;
    Keyboard.dismiss();
    setBusy(true);
    capRef.current = 92;
    setSlowHint(false);
    const slowTimer = setTimeout(() => setSlowHint(true), 15_000);
    await runImport(guardRef.current!, work, {
      onReady: () => { capRef.current = 100; setProgress(100); },
      onFail: (message) => {
        onFail(message);
        busyRef.current = false;
        setBusy(false);
      },
      save: startDraft,
      navigate: () => router.replace(to),
      wait: sleep,
    });
    clearTimeout(slowTimer);
    setSlowHint(false);
  };

  /**
   * The same progress overlay for a step that only fetches (the Google listing, before "Is this you?"):
   * nothing is saved and the screen stays; `onDone` gets the result. Stale runs report nothing.
   */
  const fetchOnly = async <T,>(work: () => Promise<T>, onDone: (result: T) => void, onFail: (message: string) => void) => {
    if (busyRef.current) return;
    busyRef.current = true;
    Keyboard.dismiss();
    setBusy(true);
    capRef.current = 92;
    setSlowHint(false);
    const slowTimer = setTimeout(() => setSlowHint(true), 15_000);
    const guard = guardRef.current!;
    const runId = guard.next();
    let result: { ok: true; value: T } | { ok: false; message: string };
    try {
      result = { ok: true, value: await work() };
    } catch (err: any) {
      result = { ok: false, message: err?.message || 'Something went wrong — try again.' };
    }
    clearTimeout(slowTimer);
    if (!guard.isCurrent(runId)) return;
    busyRef.current = false;
    setBusy(false);
    setSlowHint(false);
    if (result.ok) onDone(result.value);
    else onFail(result.message);
  };

  return { busy, progress, slowHint, run, fetchOnly };
}
