import { useEffect, useState } from 'react';
import Storage from 'expo-sqlite/kv-store';

/** Where the Learn clips live. The slug is the file name: <BASE>/<slug>.mp4 and <BASE>/<slug>.jpg (poster). */
export const LEARN_CLIP_BASE = (process.env.EXPO_PUBLIC_LEARN_CLIP_BASE || 'https://aibarber.org/learn-clips').replace(/\/+$/, '');
export const CLIPS_CACHE_KEY = 'learn_clips_manifest_v1';
const TIMEOUT_MS = 3000;
const SLUG = /^[a-z0-9][a-z0-9-]*$/;

export type LearnClip = { url: string; poster: string };
export type LearnClips = Record<string, LearnClip>;

/** Manifest { version: 1, clips: { <slug>: { v } } } -> urls. Anything malformed is skipped; never throws. */
export function parseManifest(json: unknown, base: string = LEARN_CLIP_BASE): LearnClips {
  const out: LearnClips = {};
  if (!json || typeof json !== 'object' || Array.isArray(json)) return out;
  const m = json as { version?: unknown; clips?: unknown };
  if (m.version !== 1 || !m.clips || typeof m.clips !== 'object' || Array.isArray(m.clips)) return out;
  for (const [slug, entry] of Object.entries(m.clips as Record<string, unknown>)) {
    const v = entry && typeof entry === 'object' ? (entry as { v?: unknown }).v : undefined;
    if (!SLUG.test(slug) || typeof v !== 'number' || !Number.isInteger(v) || v < 1) continue;
    out[slug] = { url: `${base}/${slug}.mp4?v=${v}`, poster: `${base}/${slug}.jpg?v=${v}` };
  }
  return out;
}

async function readCache(): Promise<LearnClips> {
  try {
    const raw = await Storage.getItem(CLIPS_CACHE_KEY);
    return raw ? parseManifest(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

/** Fetches the manifest (short timeout), caches a good copy, and falls back to the cached one. Never throws. */
export async function fetchClips(): Promise<LearnClips> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const res = await Promise.race([
      fetch(`${LEARN_CLIP_BASE}/clips.json`, ctl ? { signal: ctl.signal } : undefined),
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => {
          ctl?.abort();
          rej(new Error('timeout'));
        }, TIMEOUT_MS);
      }),
    ]);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const json = await res.json();
    const parsed = parseManifest(json);
    if (!Object.keys(parsed).length && !(json && typeof json === 'object' && (json as any).version === 1)) throw new Error('invalid');
    try {
      await Storage.setItem(CLIPS_CACHE_KEY, JSON.stringify(json));
    } catch {
      /* cache is best effort */
    }
    return parsed;
  } catch {
    return readCache();
  } finally {
    if (timer) clearTimeout(timer);
  }
}

let session: Promise<LearnClips> | null = null;
/** One fetch per app session. */
export const getLearnClips = (): Promise<LearnClips> => (session ||= fetchClips());
export const resetLearnClips = () => {
  session = null;
};

/** The clips by slug. {} until (and unless) the manifest arrives: the screen is just the text meanwhile. */
export function useLearnClips(): LearnClips {
  const [clips, setClips] = useState<LearnClips>({});
  useEffect(() => {
    let live = true;
    getLearnClips().then((c) => {
      if (live && Object.keys(c).length) setClips(c);
    }).catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return clips;
}
