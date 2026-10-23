export interface Hole { x: number; y: number; w: number; h: number }
export interface TipPlace {
  centred: boolean;
  /** Tip sits above the target (true) or below it. */
  above: boolean;
  /** Window y of the target edge the card hangs from (bottom edge when below, top edge when above). */
  edge: number;
}

const GAP = 14;
const CARD_MIN = 170; // room the card needs

/** Where the tip goes: below the target when there is room, else above it; centred without a target. */
export function placeTip(hole: Hole | null, _winW: number, winH: number): TipPlace {
  if (!hole) return { centred: true, above: false, edge: 0 };
  const below = winH - (hole.y + hole.h);
  if (below >= CARD_MIN + GAP) return { centred: false, above: false, edge: hole.y + hole.h + GAP };
  return { centred: false, above: true, edge: hole.y - GAP };
}
