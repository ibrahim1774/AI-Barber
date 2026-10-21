import { Tabs } from 'expo-router';
import { colors, fonts } from '@/constants/theme';
import { GearIcon, PencilIcon } from '@/components/Icons';
import { TAB_BAR_HIDDEN, TAB_BAR_STYLE } from '@/lib/tabBar';

/**
 * Home once a site exists: Edit (the editor) and Settings (the live link,
 * account, subscription). Each screen hides the bar itself while it must not
 * be left (the editor's prompts / guide) via tabBarStyle.
 */
export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: colors.bg },
        tabBarStyle: TAB_BAR_STYLE,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarLabelStyle: { fontFamily: fonts.bodySemi, fontSize: 11 },
      }}
    >
      {/* Hidden until the editor knows no overlay is coming (it shows the bar itself). */}
      <Tabs.Screen
        name="edit"
        options={{
          title: 'Edit',
          tabBarStyle: TAB_BAR_HIDDEN,
          tabBarIcon: ({ color, size }) => <PencilIcon size={size - 2} color={color} />,
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Settings',
          tabBarIcon: ({ color, size }) => <GearIcon size={size - 2} color={color} />,
        }}
      />
    </Tabs>
  );
}
