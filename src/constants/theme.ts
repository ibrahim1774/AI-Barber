import {
  Montserrat_400Regular,
  Montserrat_400Regular_Italic,
  Montserrat_600SemiBold,
  Montserrat_600SemiBold_Italic,
  Montserrat_700Bold,
  Montserrat_900Black,
} from '@expo-google-fonts/montserrat';
import {
  Manrope_400Regular,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
} from '@expo-google-fonts/manrope';

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

// Montserrat for headings, Manrope for body text. The web importer's
// Instrument Serif headlines are set in Montserrat (app-wide font rule).
export const fonts = {
  heading: 'Montserrat_700Bold',
  headingItalic: 'Montserrat_600SemiBold_Italic',
  headingBlack: 'Montserrat_900Black',
  serifish: 'Montserrat_400Regular_Italic', // web's italic serif step lines
  subhead: 'Montserrat_600SemiBold',
  label: 'Montserrat_400Regular',
  body: 'Manrope_400Regular',
  bodySemi: 'Manrope_600SemiBold',
  bodyBold: 'Manrope_700Bold',
  bodyExtra: 'Manrope_800ExtraBold',
  mono: 'Menlo',
} as const;

export const fontAssets = {
  Montserrat_400Regular,
  Montserrat_400Regular_Italic,
  Montserrat_600SemiBold,
  Montserrat_600SemiBold_Italic,
  Montserrat_700Bold,
  Montserrat_900Black,
  Manrope_400Regular,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
};
