// The six brand accent swatches used by EVERY color picker in the app — the
// floating in-site picker, the /booksy & /generate customize overlay, and the
// homepage/subpage generator forms — so the whole flow offers one consistent
// palette. Each value is written straight onto WebsiteData.colorTheme (a hex),
// which resolveAibTheme / the Prime + Euphoria renderers theme the site around.
export const BRAND_SWATCHES = ['#f4a100', '#ffffff', '#dc2626', '#22c55e', '#3b82f6', '#a855f7'];

// The default accent (gold) used when nothing has been picked yet.
export const DEFAULT_SWATCH = BRAND_SWATCHES[0];
