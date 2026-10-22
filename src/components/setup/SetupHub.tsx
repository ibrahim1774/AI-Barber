import { useEffect, useState } from 'react';
import { Alert, Text } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Card, Note, Row, TextAction, ToggleRow } from '@/components/setup/ui';
import { BookButtonPicker } from '@/components/setup/BookButtonPicker';
import { bookingPrefs, withChoice, type BookingChoice } from '@/lib/bookingChoice';
import { updateSiteRecord } from '@/lib/setup/siteSync';
import { useUpdateSitePrompt } from '@/lib/setupPrompt';
import { bookingUrl, icsUrl, listMembers, updateShopSettings, type Member, type Shop } from '@/lib/shop';
import type { SiteRecord } from '@/lib/siteStore';

export const PLAN_PENDING = 'Your booking page opens once your AI Barber plan is active.';

export type HubTarget = 'services' | 'barbers' | 'hours' | 'rules' | 'pay';

/** The Setup (gear) screen: Services, Barbers, Hours, Booking rules, Get paid, calendar link, Book button. */
export function SetupHub({
  shop, site, onOpen, onShopChanged, onSiteChanged,
}: {
  shop: Shop;
  site: SiteRecord;
  onOpen(t: HubTarget): void;
  onShopChanged(): void;
  onSiteChanged(s: SiteRecord): void;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [busy, setBusy] = useState(false);
  const sitePrompt = useUpdateSitePrompt('bookings');
  useEffect(() => { listMembers(shop.id).then(setMembers).catch(() => {}); }, [shop.id]);

  const { own, choice } = bookingPrefs(site);

  const setEnabled = async (on: boolean) => {
    setBusy(true);
    try {
      await updateShopSettings(shop.id, { bookingsEnabled: on });
      onShopChanged();
      // Bookings on or off changes the live site's Book button: offer to update it now.
      void sitePrompt.offer().catch(() => {});
    } catch (e) {
      Alert.alert("Couldn't save", e instanceof Error ? e.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  const setChoice = async (c: BookingChoice) => {
    const saved = await updateSiteRecord((r) => withChoice(r, c, shop)).catch(() => null);
    if (saved) {
      onSiteChanged(saved);
      void sitePrompt.offer().catch(() => {});
    } else Alert.alert("Couldn't save", 'Try again.');
  };

  const copyCalendar = async (m: Member) => {
    const url = icsUrl(m);
    if (!url) return;
    await Clipboard.setStringAsync(url);
    Alert.alert('Copied', `Add it in your Calendar app as a subscription to see ${m.role === 'owner' ? 'your' : `${m.name}'s`} bookings.`);
  };

  return (
    <>
      <Card>
        <ToggleRow
          label="Take bookings"
          detail={
            !shop.bookingsEnabled
              ? 'Off: your booking page shows as paused.'
              : shop.purchaseLinked
                ? bookingUrl(shop)
                : PLAN_PENDING
          }
          value={shop.bookingsEnabled}
          onValueChange={(v) => void setEnabled(v)}
          disabled={busy}
        />
      </Card>
      <BookButtonPicker own={own} choice={choice} onChange={(c) => void setChoice(c)} />
      <Card>
        <Row label="Services" detail="Prices, lengths, deposits" onPress={() => onOpen('services')} />
        <Row label="Barbers" detail={members.length > 1 ? `${members.length} people` : 'Just you'} onPress={() => onOpen('barbers')} />
        <Row label="Hours" onPress={() => onOpen('hours')} />
        <Row label="Booking rules" detail="Advanced: notice, gaps, cancelling" onPress={() => onOpen('rules')} />
        <Row label="Get paid" detail="In the shop, Cash App, Venmo, Zelle, PayPal, cards" onPress={() => onOpen('pay')} />
      </Card>
      {members.some((m) => m.icsToken) && (
        <Card title="Calendar subscription link">
          <Note>See your bookings in Apple or Google Calendar.</Note>
          {members.filter((m) => m.icsToken).map((m) => (
            <TextAction key={m.id} title={`Copy ${m.role === 'owner' ? 'my' : `${m.name}'s`} calendar link`} onPress={() => void copyCalendar(m)} />
          ))}
        </Card>
      )}
      <Text />
    </>
  );
}
