import { Tabs } from 'expo-router';
import { colors, fonts } from '@/constants/theme';
import { GearIcon, PencilIcon } from '@/components/Icons';
import { CalendarIcon } from '@/components/bookings/icons';
import { BagIcon } from '@/components/store/icons';
import { useBookingsPush } from '@/lib/bookings/push';
import { TAB_BAR_HIDDEN, TAB_BAR_STYLE } from '@/lib/tabBar';

/**
 * Home once a site exists: Edit (the editor), Bookings (the day's
 * appointments), Store (products and orders) and Settings (the live link, account, subscription). Each screen hides the bar itself while it must not
 * be left (the editor's prompts / guide) via tabBarStyle.
 */
export default function TabsLayout() {
  // Registers the push token and routes booking-push taps to the Bookings tab.
  useBookingsPush();
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
        name="bookings"
        options={{
          title: 'Bookings',
          tabBarIcon: ({ color, size }) => <CalendarIcon size={size - 2} color={color} />,
        }}
      />
      <Tabs.Screen
        name="store"
        options={{
          title: 'Store',
          tabBarIcon: ({ color, size }) => <BagIcon size={size - 2} color={color} />,
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
