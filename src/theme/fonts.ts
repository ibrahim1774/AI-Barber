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
  heading: family.extrabold,
  headingItalic: family.semiboldItalic,
  headingBlack: family.extrabold,
  serifish: family.regularItalic,
  subhead: family.semibold,
  label: family.regular,
  body: family.regular,
  bodyMedium: family.medium,
  bodySemi: family.semibold,
  bodyBold: family.bold,
  bodyExtra: family.extrabold,
  mono: 'Menlo',
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
