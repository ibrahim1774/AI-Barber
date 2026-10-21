import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Text } from 'react-native';
import { router } from 'expo-router';
import { colors, fonts } from '@/constants/theme';
import { Button } from '@/components/Button';
import { Page } from '@/components/Page';
import { GetPaid } from '@/components/setup/GetPaid';
import { goBackOrHome } from '@/lib/nav';
import { loadMyShop, type Shop } from '@/lib/shop';

/** "How do you want to get paid?" Also where aibarber://get-paid (the Stripe return) lands. */
export default function GetPaidScreen() {
  const [shop, setShop] = useState<Shop | null | undefined>(undefined);
  const load = useCallback(() => { loadMyShop().then(setShop).catch(() => setShop(null)); }, []);
  useEffect(load, [load]);

  return (
    <Page title="Get paid" onBack={goBackOrHome}>
      {shop === undefined && <ActivityIndicator color={colors.accent} style={{ marginTop: 48 }} />}
      {shop === null && (
        <>
          <Text style={{ fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.body, marginBottom: 16 }}>
            Set up bookings first, then choose how customers pay you.
          </Text>
          <Button title="Set up bookings" onPress={() => router.replace('/bookings-setup')} />
        </>
      )}
      {shop && <GetPaid shop={shop} onChanged={load} />}
    </Page>
  );
}
