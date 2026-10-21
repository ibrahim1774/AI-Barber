import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, View } from 'react-native';
import { router } from 'expo-router';
import { Button } from '@/components/Button';
import { ShareSheet } from '@/components/ShareSheet';
import { Card, Input, Label, Note, Row, ToggleRow } from '@/components/setup/ui';
import { colors } from '@/constants/theme';
import { updateSiteData } from '@/lib/setup/siteSync';
import type { Shop } from '@/lib/shop';
import {
  loadStoreSettings, shopUrl, updateStoreSettings, type StoreSettings,
} from '@/lib/store/data.stub-a3b';
import { canOpenShop, formFromSettings, validateSettings, type SettingsForm } from '@/lib/store/settings';
import type { WebsiteData } from '@/web/types';

/** `shopUrl` joins WebsiteData when the controller runs sync-web.sh; until then this carries it. */
type WithShopUrl = WebsiteData & { shopUrl?: string };

export const PLAN_PENDING = 'Your shop opens to customers once your AI Barber plan is active.';

/** Pickup, shipping, Get paid, and Open / Close my shop. */
export function StoreSettingsForm({ shop, onChanged }: { shop: Shop; onChanged?(): void }) {
  const [saved, setSaved] = useState<StoreSettings | null>(null);
  const [form, setForm] = useState<SettingsForm | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    let alive = true;
    loadStoreSettings(shop.id)
      .then((s) => {
        if (!alive) return;
        setSaved(s);
        setForm(formFromSettings(s));
      })
      .catch((e) => alive && setLoadError(e instanceof Error ? e.message : "Couldn't load your shop settings."));
    return () => {
      alive = false;
    };
  }, [shop.id]);

  if (loadError) return <Note tone="error">{loadError}</Note>;
  if (!saved || !form) return <ActivityIndicator color={colors.accent} style={{ marginTop: 32 }} />;

  const set = (patch: Partial<SettingsForm>) => {
    setForm({ ...form, ...patch });
    setProblem(null);
  };
  const dirty = JSON.stringify(form) !== JSON.stringify(formFromSettings(saved));
  const payReady = shop.payInShop || shop.stripeChargesEnabled || Object.values(shop.manualHandles).some(Boolean);

  /** Validates and writes the form; returns the settings now saved, or null (problem shown). */
  const save = async (): Promise<StoreSettings | null> => {
    const r = validateSettings(form);
    if (!r.ok) {
      setProblem(r.error);
      return null;
    }
    await updateStoreSettings(shop.id, r.values);
    const next = { ...saved, ...r.values };
    setSaved(next);
    setForm(formFromSettings(next));
    return next;
  };

  const guard = async (work: () => Promise<void>) => {
    setBusy(true);
    try {
      await work();
    } catch (e) {
      Alert.alert("Couldn't save", e instanceof Error ? e.message : 'Try again.');
    } finally {
      setBusy(false);
    }
  };

  const onSave = () =>
    guard(async () => {
      if (await save()) onChanged?.();
    });

  const setOpen = (open: boolean) =>
    guard(async () => {
      let current = saved;
      if (open && dirty) {
        const next = await save();
        if (!next) return;
        current = next;
      }
      if (open && !canOpenShop(current, payReady)) {
        setProblem('Turn on pickup, shipping, or both before you open your shop.');
        return;
      }
      await updateStoreSettings(shop.id, { storeEnabled: open });
      setSaved({ ...current, storeEnabled: open });
      const url = shopUrl(shop);
      await updateSiteData((d) => {
        const next: WithShopUrl = { ...d };
        if (open) next.shopUrl = url;
        else delete next.shopUrl;
        return next;
      });
      if (open) Alert.alert('Your shop is open', 'Publish to add a Shop link to your website.');
      onChanged?.();
    });

  return (
    <>
      <Card title="Pickup">
        <ToggleRow label="Pickup" detail="Customers collect from you." value={form.pickup} onValueChange={(v) => set({ pickup: v })} />
        {form.pickup && (
          <>
            <Label>Pickup instructions</Label>
            <Input
              label="Pickup instructions"
              placeholder="Ask at the front desk, or text when you're outside."
              value={form.pickupNote}
              onChangeText={(v) => set({ pickupNote: v })}
              multiline
              maxLength={500}
            />
          </>
        )}
      </Card>
      <Card title="Shipping">
        <ToggleRow label="Shipping" detail="One flat rate per order." value={form.shipping} onValueChange={(v) => set({ shipping: v })} />
        {form.shipping && (
          <>
            <Label>Flat shipping rate</Label>
            <Input label="Flat shipping rate" placeholder="$5.00" value={form.shippingFlat} onChangeText={(v) => set({ shippingFlat: v })} keyboardType="decimal-pad" />
            <Label>Ships within (days)</Label>
            <Input label="Ships within days" placeholder="3" value={form.shipsWithin} onChangeText={(v) => set({ shipsWithin: v })} keyboardType="number-pad" />
          </>
        )}
      </Card>
      {!!problem && <Note tone="error">{problem}</Note>}
      {dirty && <Button title="Save" loading={busy} onPress={() => void onSave()} style={{ marginBottom: 16 }} />}

      <Card>
        <Row
          label="Get paid"
          detail={payReady ? 'In the shop, Cash App, Venmo, Zelle, PayPal, cards' : 'Choose how customers pay you'}
          onPress={() => router.push('/get-paid')}
        />
      </Card>

      <Card title={saved.storeEnabled ? 'Your shop is open' : 'Open your shop'}>
        <Note>
          {saved.storeEnabled
            ? shop.purchaseLinked ? shopUrl(shop) : PLAN_PENDING
            : 'Customers can browse and order once it is open. You can add products any time.'}
        </Note>
        <Button
          title={saved.storeEnabled ? 'Close my shop' : 'Open my shop'}
          variant={saved.storeEnabled ? 'ghost' : 'primary'}
          loading={busy}
          onPress={() => void setOpen(!saved.storeEnabled)}
        />
        {saved.storeEnabled && <Row label="Share your shop link" onPress={() => setShareOpen(true)} />}
      </Card>
      <View />
      <ShareSheet
        visible={shareOpen}
        shopName={shop.name}
        links={[{ kind: 'shop', url: shopUrl(shop) }]}
        source="settings"
        onClose={() => setShareOpen(false)}
      />
    </>
  );
}
