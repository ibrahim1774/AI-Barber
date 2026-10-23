// Colours copied from the web. Importer screens use GbpImportPage.tsx's BK
// tokens (ink-blue-black canvas, porcelain text, ONE gold accent); the
// generating screen and the classic form use the app-wide #0d0d0d / #f4a100.
export const colors = {
  bg: '#0d0d0d',
  importerBg: '#070709',
  panel: '#0B0E14', // BK.bg — import progress overlay, header "A" mark
  text: '#EDEFF4',
  heading: '#F4F5F8',
  chipText: '#D6D9E0',
  body: '#8B919E',
  muted: '#8A93A6',
  faint: '#5A6274',
  hair: 'rgba(237,239,244,0.08)',
  ghostBorder: 'rgba(237,239,244,0.22)',
  ghostBg: 'rgba(237,239,244,0.04)',
  accent: '#f4a100',
  accentDeep: '#8a5c00',
  accentInk: '#15130C',
  silver: '#AEB4C0', // italic "website" in the importer headlines
  // On the white import card
  ink: '#0B0E14',
  inkMuted: '#6B7280',
  inkLine: 'rgba(11,14,20,0.16)',
  inkPlaceholder: 'rgba(11,14,20,0.3)',
  inkRow: 'rgba(11,14,20,0.08)',
  error: '#b91c1c',
  errorRule: '#dc2626',
  // Classic form button text / loading screen
  buttonInk: '#1a1a1a',
  track: '#1a1a1a',
  grey: '#888888',
  // Editor overlays (HomeBookingPrompts / HomeLaunchGuide / BooksyDesignSwitcher
  // use their own softer gold on a warm glass card).
  overlayGold: '#e8c074',
  overlayGoldDark: '#8a6b30',
  overlayCard: 'rgba(14,12,8,0.94)',
  sheet: '#141414',
  danger: '#ef4444',
} as const;

// Spoken names for BRAND_SWATCHES (the web labels them by hex only).
export const swatchNames: Record<string, string> = {
  '#f4a100': 'Gold',
  '#ffffff': 'White',
  '#dc2626': 'Red',
  '#22c55e': 'Green',
  '#3b82f6': 'Blue',
  '#a855f7': 'Purple',
};
export const swatchLabel = (hex: string) => `Use color ${swatchNames[hex.toLowerCase()] ?? hex}`;

// Typography lives in one file; re-exported so existing imports keep working.
export { fonts, fontAssets } from '@/theme/fonts';
