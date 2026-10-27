export interface Hole { x: number; y: number; w: number; h: number }
export interface Insets { top: number; bottom: number }
export interface TipPlace {
  centred: boolean;
  /** Tip sits above the target (true) or below it. Always false when pinned. */
  above: boolean;
  /** Set when neither side has room: the card is pinned to the bottom of the safe area, over the dimmed target. */
  pinned?: 'bottom';
  /** Window y of the target edge the card hangs from (bottom edge when below, top edge when above; the card's bottom when pinned). */
  edge: number;
}

const GAP = 14;
const MARGIN = 8; // never closer than this to the safe area
const PIN_GAP = 12;
export const CARD_MIN = 170; // room the card needs when it has not been measured yet

/**
 * Where the tip goes: below the target when it fits, else above it, else pinned to the bottom of the safe area.
 * Centred without a target. The card always stays inside [insets.top + 8, winH - insets.bottom - 8].
 */
export function placeTip(
  hole: Hole | null, _winW: number, winH: number, insets: Insets = { top: 0, bottom: 0 }, cardH = CARD_MIN,
): TipPlace {
  if (!hole) return { centred: true, above: false, edge: 0 };
  const belowTop = hole.y + hole.h + GAP;
  if (belowTop + cardH <= winH - insets.bottom - MARGIN) return { centred: false, above: false, edge: belowTop };
  const aboveEdge = hole.y - GAP;
  if (aboveEdge - cardH >= insets.top + MARGIN && aboveEdge <= winH - insets.bottom - MARGIN) {
    return { centred: false, above: true, edge: aboveEdge };
  }
  return { centred: false, above: false, pinned: 'bottom', edge: winH - insets.bottom - PIN_GAP };
}

/** The part of the hole inside the visible area (below the status bar, above the home indicator); null when none is. */
export function clampHole(hole: Hole, winW: number, winH: number, insets: Insets): Hole | null {
  const x0 = Math.max(0, hole.x);
  const y0 = Math.max(insets.top, hole.y);
  const x1 = Math.min(winW, hole.x + hole.w);
  const y1 = Math.min(winH - insets.bottom, hole.y + hole.h);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
