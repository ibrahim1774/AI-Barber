import type { DraftBase } from './webDraftEngine';
const memory = new Map<string,string>();
const key = (uid: string) => `webDraftBase.v2.${uid}`;
// The merge base belongs to this tab's editor. Sharing it through localStorage would let a different tab
// advance the base before this editor has adopted its changes, making stale fields look like new edits.
export async function readWebDraftBase(uid: string): Promise<DraftBase | null> {
  try {
    let raw = memory.get(key(uid));
    try { raw = globalThis.sessionStorage?.getItem(key(uid)) ?? raw; } catch {}
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
export async function rememberWebDraftBase(base: DraftBase): Promise<void> {
  const raw = JSON.stringify(base); memory.set(key(base.owner),raw);
  try { globalThis.sessionStorage?.setItem(key(base.owner),raw); } catch {}
}
