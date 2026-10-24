import type { WebsiteData } from '@/web/types';
import { copyBlockInfo, copyDefault, isCopyKey, variantIndex } from '@/web/lib/render/guides';

/**
 * Edits of the library text (the `copy` map and `extraPages.pick`). Every update returns NEW objects for `copy`
 * and `extraPages`: the renderer caches the overrides per `copy` object, so changing one in place would keep
 * showing the old text.
 */

const withoutKey = (copy: Record<string, string> | undefined, key: string): Record<string, string> | undefined => {
  if (!copy || !Object.prototype.hasOwnProperty.call(copy, key)) return copy;
  const { [key]: _gone, ...rest } = copy;
  void _gone;
  return Object.keys(rest).length ? rest : undefined;
};

const withCopy = (d: WebsiteData, copy: Record<string, string> | undefined): WebsiteData => {
  const { copy: _old, ...rest } = d;
  void _old;
  return copy ? { ...rest, copy } : (rest as WebsiteData);
};

/** The longest text the block takes, counted in characters (not UTF-16 units). */
const cap = (text: string, max: number): string => Array.from(text.trim()).slice(0, max).join('').trim();

/**
 * Save the text typed for one block. Empty, or the same words as the suggested text, removes the override (the
 * block follows the shop's data again). A key outside the library changes nothing.
 */
export function saveCopyText(d: WebsiteData, key: string, value: string): WebsiteData {
  if (!isCopyKey(key)) return d;
  const max = copyBlockInfo(key)?.max ?? 600;
  const text = cap(value, max);
  if (text === '' || text === copyDefault(d, key).trim()) return withCopy(d, withoutKey(d.copy, key));
  return withCopy(d, { ...(d.copy ?? {}), [key]: text });
}

/** "Reset to suggested": drop the override. */
export function resetCopy(d: WebsiteData, key: string): WebsiteData {
  return isCopyKey(key) ? withCopy(d, withoutKey(d.copy, key)) : d;
}

/** True when the barber has written their own text for the block (it no longer follows the shop's prices). */
export const isCopyEdited = (d: WebsiteData, key: string): boolean =>
  !!d.copy && Object.prototype.hasOwnProperty.call(d.copy, key) && typeof d.copy[key] === 'string' && d.copy[key].trim() !== '';

/** "Try other wording": the next of the three wordings (and the barber's own text, if any, is dropped). */
export function tryOtherWording(d: WebsiteData, key: string): WebsiteData {
  if (!isCopyKey(key) || !d.extraPages) return d;
  const next = ((variantIndex(d, key) + 1) % 3) as 0 | 1 | 2;
  const cleared = resetCopy(d, key);
  return { ...cleared, extraPages: { ...cleared.extraPages!, pick: { ...(cleared.extraPages!.pick ?? {}), [key]: next } } };
}
