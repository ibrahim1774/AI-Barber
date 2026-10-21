import type { ViewStyle } from 'react-native';
import { colors } from '@/constants/theme';

/** The two-tab home's bar (Edit, Settings): dark, gold when active. */
export const TAB_BAR_STYLE: ViewStyle = {
  backgroundColor: colors.bg,
  borderTopColor: 'rgba(255,255,255,0.1)',
};

/** What a tab screen sets to hide the bar (the editor's overlays, Settings without a site). */
export const TAB_BAR_HIDDEN: ViewStyle = { display: 'none' };

export function tabBarStyle(hidden: boolean): ViewStyle {
  return hidden ? TAB_BAR_HIDDEN : TAB_BAR_STYLE;
}
