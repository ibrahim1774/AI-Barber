/** Add a service from the preview opens the Services sheet only when nothing else (sheet or overlay) is open. */
export function canOpenAddService(sheet: string | null, overlay: string | null): boolean {
  return sheet == null && !overlay;
}

/** The "open at the add view" flag only lives while the Services sheet is the open sheet. */
export function keepServicesAdd(add: boolean, sheet: string | null): boolean {
  return add && sheet === 'services';
}
