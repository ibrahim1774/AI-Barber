/** Add a service from the preview opens the Services sheet only when nothing else (sheet or overlay) is open. */
export function canOpenAddService(sheet: string | null, overlay: string | null): boolean {
  return sheet == null && !overlay;
}

/** The "open at the add view" flag only lives while the Services sheet is the open sheet. */
export function keepServicesAdd(add: boolean, sheet: string | null): boolean {
  return add && sheet === 'services';
}

/** A tap on a service card in the preview: the position in data.services, when the sheet may open and the card exists. */
export function serviceFocusFor(sheet: string | null, overlay: string | null, services: readonly unknown[] | undefined, index: number): number | null {
  if (!canOpenAddService(sheet, overlay)) return null;
  return Number.isInteger(index) && index >= 0 && index < (services?.length ?? 0) ? index : null;
}

/** The focus on a service only lives while the Services sheet is the open sheet (a lapse close or another sheet ends it). */
export function keepServicesFocus(focus: number | null, sheet: string | null): number | null {
  return focus != null && sheet === 'services' ? focus : null;
}
