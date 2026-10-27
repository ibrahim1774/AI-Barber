// The app's ONE typeface. To swap it: install the new @expo-google-fonts
// package, change the import + the `family` map below. Nothing else in the
// app names a font family; everything reads `fonts` (re-exported from
// @/constants/theme) and loads `fontAssets` once in the root layout.
import {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_400Regular_Italic,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_600SemiBold_Italic,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';

const family = {
  regular: 'PlusJakartaSans_400Regular',
  regularItalic: 'PlusJakartaSans_400Regular_Italic',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  semiboldItalic: 'PlusJakartaSans_600SemiBold_Italic',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
} as const;

export const fonts = {
  // Refined, light feel (Ibrahim picked 'A': Medium 500 for headlines and buttons, Regular 400
  // for body text). Names are kept so nothing else in the app changes; the hierarchy now comes
  // from size, spacing and colour rather than weight. To get heavier again, change these lines only.
  heading: family.medium,
  headingItalic: family.regularItalic,
  headingBlack: family.medium,
  serifish: family.regularItalic,
  subhead: family.medium,
  label: family.regular,
  body: family.regular,
  bodyMedium: family.medium,
  bodySemi: family.medium,
  bodyBold: family.medium,
  bodyExtra: family.medium,
  // URLs and the progress percent use the app font too (one family everywhere).
  mono: family.medium,
} as const;

export const fontAssets = {
  PlusJakartaSans_400Regular,
  PlusJakartaSans_400Regular_Italic,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_600SemiBold_Italic,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
};
