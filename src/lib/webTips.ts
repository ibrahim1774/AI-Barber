// Web only (imported by WebTips.web.tsx and the Settings row; the phone app never loads it).
// Non-blocking editor hints: which tips exist, which are still worth showing, and the per-device memory
// (dismissed tips, the Hide/Show switch, and the draft's starting point used to notice "the owner did it").
import { useSyncExternalStore } from 'react';
import Storage from 'expo-sqlite/kv-store';
import { stockPhotoPaths } from '@/lib/editor';
import type { WebsiteData } from '@/web/types';

export type TipId = 'photos' | 'phone' | 'services' | 'hours' | 'team' | 'pages' | 'publish';

/** Copy reuses the coach-mark wording where it already said the same thing. */
export const TIPS: Record<TipId, { text: string; label: string }> = {
  photos: { text: 'Tap a photo to change it', label: 'Tip: tap a photo to change it. Opens your photos.' },
  phone: { text: 'Add your phone number', label: 'Tip: add your phone number. Opens the phone field.' },
  services: { text: 'Add your services and prices here', label: 'Tip: add your services and prices. Opens services.' },
  hours: { text: 'Set your opening hours', label: 'Tip: set your opening hours. Opens hours.' },
  team: { text: 'Add your team', label: 'Tip: add your team. Opens your team.' },
  pages: { text: 'Add pages like FAQ', label: 'Tip: turn pages on or off and add pages like FAQ. Opens pages.' },
  publish: { text: 'Ready? Tap Publish to put your website online', label: 'Tip: ready? Tap Publish to put your website online.' },
};
export const TIP_ORDER: TipId[] = ['photos', 'phone', 'services', 'hours', 'team', 'pages', 'publish'];

/** What the draft looked like when the hints first appeared; a change means the owner did that action. */
export type Baseline = { stock: number; services: string; hours: string; team: string; pages: string };
const j = (v: unknown) => JSON.stringify(v ?? null);

export function baselineOf(d: WebsiteData): Baseline {
  return { stock: stockPhotoPaths(d).length, services: j(d.services), hours: j(d.hours), team: j(d.staff), pages: j([d.pages, d.extraPages]) };
}

/** True once the action behind a tip is done (so the tip goes away by itself). */
export function tipDone(id: TipId, d: WebsiteData, base: Baseline, published: boolean): boolean {
  switch (id) {
    case 'photos': return stockPhotoPaths(d).length < base.stock || base.stock === 0;
    case 'phone': return !!d.phone?.trim();
    case 'services': return j(d.services) !== base.services;
    case 'hours': return j(d.hours) !== base.hours;
    case 'team': return j(d.staff) !== base.team;
    case 'pages': return j([d.pages, d.extraPages]) !== base.pages;
    case 'publish': return published;
  }
}

/** Tips to show now, in order. The Publish tip is `prominent` once it is the only one left. */
export function visibleTips(
  d: WebsiteData, base: Baseline | null, published: boolean, s: { off: boolean; dismissed: ReadonlySet<string> },
): { id: TipId; prominent: boolean }[] {
  if (s.off || !base) return [];
  const ids = TIP_ORDER.filter((id) => !s.dismissed.has(id) && !tipDone(id, d, base, published));
  const others = ids.filter((id) => id !== 'publish').length;
  return ids.map((id) => ({ id, prominent: id === 'publish' && others === 0 }));
}

// ---- per-device memory ------------------------------------------------------------------------------------------
const K_OFF = 'webtips:off:v1';
const K_DISMISSED = 'webtips:dismissed:v1';
const kBase = (draftId: string) => `webtips:base:v1:${draftId}`;

type S = { loaded: boolean; off: boolean; dismissed: ReadonlySet<string> };
let state: S = { loaded: false, off: false, dismissed: new Set() };
const listeners = new Set<() => void>();
const set = (s: S) => { state = s; listeners.forEach((l) => l()); };
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

export async function loadTips(): Promise<void> {
  try {
    const off = (await Storage.getItem(K_OFF)) === '1';
    const raw = await Storage.getItem(K_DISMISSED);
    const arr = raw ? (JSON.parse(raw) as string[]) : [];
    set({ loaded: true, off, dismissed: new Set(Array.isArray(arr) ? arr : []) });
  } catch { set({ ...state, loaded: true }); }
}
export function setTipsOff(off: boolean): void {
  set({ ...state, off });
  void Storage.setItem(K_OFF, off ? '1' : '0').catch(() => {});
}
export function dismissTip(id: TipId): void {
  const dismissed = new Set(state.dismissed); dismissed.add(id);
  set({ ...state, dismissed });
  void Storage.setItem(K_DISMISSED, JSON.stringify([...dismissed])).catch(() => {});
}
/** "Show tips" brings back the ones that were dismissed too. */
export function showTipsAgain(): void {
  set({ ...state, off: false, dismissed: new Set() });
  void Storage.setItem(K_OFF, '0').catch(() => {});
  void Storage.setItem(K_DISMISSED, '[]').catch(() => {});
}
export const useTipsState = (): S => useSyncExternalStore(subscribe, () => state, () => state);

export async function loadBaseline(draftId: string, d: WebsiteData): Promise<Baseline> {
  try {
    const raw = await Storage.getItem(kBase(draftId));
    if (raw) return JSON.parse(raw) as Baseline;
  } catch { /* fall through: start now */ }
  const b = baselineOf(d);
  void Storage.setItem(kBase(draftId), JSON.stringify(b)).catch(() => {});
  return b;
}

/** Test hook. */
export function __resetTips(): void { state = { loaded: false, off: false, dismissed: new Set() }; listeners.clear(); }
