import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import type { Ref } from 'react';
import { ActivityIndicator, Alert, AppState, Platform, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { track } from '@/lib/analytics';
import { Button } from '@/components/Button';
import { METHODS, cardFeeNote, cardPayoutNote, checkAllHandles, feeText, payWaysCount } from '@/lib/setup/handles';
import { stripeOnboard, stripeStatus, type StripeStatus } from '@/lib/setup/ownerApi';
import { updateShopSettings, type ManualMethod, type Shop } from '@/lib/shop';
import { colors, fonts } from '@/constants/theme';
import { Card, Input, Label, Note, ToggleRow } from '@/components/setup/ui';
import {
  STRIPE_CARDS_ON, STRIPE_NEEDS_DETAILS, STRIPE_POLL_MS, STRIPE_POLL_WINDOW_MS, STRIPE_VERIFYING,
  cardState, pollingOpen, stripeReturnBanner,
} from '@/lib/stripeWeb';

export const CARDS_NOT_SET_UP = "Card payments aren't set up yet.";
export const GET_PAID_RETURN = 'aibarber://get-paid';

/** Three cards: in the shop, Cash App / Venmo / Zelle / PayPal handles, card payments through Stripe. */
export function GetPaid({ shop, onChanged, firstCardRef, stripeReturn }: { shop: Shop; onChanged(): void; firstCardRef?: Ref<View>; stripeReturn?: 'return' | 'refresh' | null }) {
  const [inShop, setInShop] = useState(shop.payInShop);
  const [inputs, setInputs] = useState<Record<ManualMethod, string>>({
    cashapp: shop.manualHandles.cashapp ?? '', venmo: shop.manualHandles.venmo ?? '',
    zelle: shop.manualHandles.zelle ?? '', paypal: shop.manualHandles.paypal ?? '',
  });
  const [errors, setErrors] = useState<Partial<Record<ManualMethod, string>>>({});
  const [savingHandles, setSavingHandles] = useState(false);
  const [status, setStatus] = useState<StripeStatus | null>(null);
  const [stripeBusy, setStripeBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [cardNote, setCardNote] = useState<string | null>(null);
  // Coming back from Stripe (web) counts as having opened it, so the status is read even before the shop row shows an account.
  const opening = useRef(Platform.OS === 'web' && !!stripeReturn);
  // Web only: the time until which the status is re-read every few seconds (set when Stripe is opened or returned from).
  const watchUntil = useRef(stripeReturn && Platform.OS === 'web' ? Date.now() + STRIPE_POLL_WINDOW_MS : 0);

  const cardReady = status ? status.chargesEnabled : shop.stripeChargesEnabled;
  const connected = status ? status.connected : shop.stripeConnected;
  const fee = feeText(shop.platformFeeBps);

  const refreshStatus = useCallback(async () => {
    if (!shop.stripeConnected && !status?.connected && !opening.current) return;
    setChecking(true);
    try {
      const st = await stripeStatus();
      setStatus(st);
      if (st.chargesEnabled && !shop.stripeChargesEnabled) onChanged();
    } catch {
      // keep what we know; the card shows the last state
    } finally {
      setChecking(false);
    }
  }, [shop.stripeConnected, shop.stripeChargesEnabled, status?.connected, onChanged]);

  // On open, and when the app comes back to the front (Stripe's page may have opened in Safari and returned by aibarber://get-paid).
  useEffect(() => {
    void refreshStatus();
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') void refreshStatus(); });
    return () => sub.remove();
  }, [refreshStatus]);

  // Web: the owner finishes Stripe in another tab, so this tab re-reads the status when it is shown again and every
  // few seconds for a while after Stripe was opened. (The phone app already does this through AppState.)
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const onShow = () => { if (document.visibilityState === 'visible') void refreshStatus(); };
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('focus', onShow);
    const timer = setInterval(() => { if (!cardReady && pollingOpen(watchUntil.current)) void refreshStatus(); }, STRIPE_POLL_MS);
    return () => {
      document.removeEventListener('visibilitychange', onShow);
      window.removeEventListener('focus', onShow);
      clearInterval(timer);
    };
  }, [refreshStatus, cardReady]);

  const saveInShop = async (value: boolean) => {
    const handles = checkAllHandles(inputs);
    const manualHandles = handles.ok ? handles.handles : shop.manualHandles;
    if (!value && payWaysCount({ payInShop: false, manualHandles, cardReady }) === 0) {
      Alert.alert('Keep at least one way to pay', 'Turn on another way first, then you can switch off paying in the shop.');
      return;
    }
    setInShop(value);
    try {
      await updateShopSettings(shop.id, { payInShop: value });
      onChanged();
    } catch (e) {
      setInShop(!value);
      Alert.alert("Couldn't save", e instanceof Error ? e.message : 'Try again.');
    }
  };

  const saveHandles = async () => {
    const r = checkAllHandles(inputs);
    if (!r.ok) {
      setErrors({ [r.method]: r.message });
      return;
    }
    setErrors({});
    if (payWaysCount({ payInShop: inShop, manualHandles: r.handles, cardReady }) === 0) {
      Alert.alert('Keep at least one way to pay', 'Add a handle, connect cards, or keep "In the shop" on.');
      return;
    }
    setSavingHandles(true);
    try {
      await updateShopSettings(shop.id, { manualHandles: r.handles });
      setInputs({ cashapp: r.handles.cashapp ?? '', venmo: r.handles.venmo ?? '', zelle: r.handles.zelle ?? '', paypal: r.handles.paypal ?? '' });
      track('pay_handles_saved', { count: Object.keys(r.handles).length });
      onChanged();
    } catch (e) {
      Alert.alert("Couldn't save", e instanceof Error ? e.message : 'Try again.');
    } finally {
      setSavingHandles(false);
    }
  };

  const connectCards = async () => {
    if (stripeBusy) return;
    setStripeBusy(true);
    opening.current = true;
    if (Platform.OS === 'web') watchUntil.current = Date.now() + STRIPE_POLL_WINDOW_MS;
    setCardNote(null);
    try {
      const { url } = await stripeOnboard();
      track('stripe_onboarding_started');
      // Stripe's page ends on aibarber.org/stripe-return, which bounces to aibarber://get-paid.
      await WebBrowser.openAuthSessionAsync(url, GET_PAID_RETURN);
      const st = await stripeStatus();
      setStatus(st);
      if (st.chargesEnabled) {
        track('stripe_onboarding_done');
        onChanged();
      } else if (!st.connected) {
        // The sheet was closed before an account was created.
        setCardNote(CARDS_NOT_SET_UP);
      }
    } catch (e) {
      Alert.alert("Couldn't open Stripe", e instanceof Error ? e.message : 'Try again.');
    } finally {
      setStripeBusy(false);
    }
  };

  return (
    <>
      <View ref={firstCardRef} collapsable={false}>
      <Card title="In the shop">
        <ToggleRow
          label="Customers pay when they arrive"
          detail="No setup. Cash, card reader or however you take money today."
          value={inShop}
          onValueChange={(v) => void saveInShop(v)}
        />
      </Card>
      </View>

      <Card title="Cash App, Venmo, Zelle, PayPal">
        <Note>
          Customers see your handle after they book and send the money themselves. Prime Barber doesn't move this money, so
          tap Mark paid when it arrives.
        </Note>
        {METHODS.map((m) => (
          <Fragment key={m.key}>
            <Input title={m.label}
              label={m.label}
              value={inputs[m.key]}
              onChangeText={(t) => setInputs((p) => ({ ...p, [m.key]: t }))}
              placeholder={m.placeholder}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType={m.key === 'zelle' ? 'email-address' : 'default'}
            />
            {errors[m.key] ? <Note tone="error">{errors[m.key]!}</Note> : <Note>{m.hint}</Note>}
          </Fragment>
        ))}
        <Button title="Save handles" size="sm" onPress={() => void saveHandles()} loading={savingHandles} style={{ marginTop: 8 }} />
      </Card>

      <Card title="Card payments">
        <Note>
          {connected ? '' : 'Takes about 5 minutes. '}Customers pay by card or Apple Pay. {cardPayoutNote()}
        </Note>
        <Note>{cardFeeNote(fee)} There is no monthly fee for cards.</Note>
        {Platform.OS === 'web' && !!stripeReturn && !!status && !cardReady && !status.detailsSubmitted && (
          <Note tone="warn">{stripeReturnBanner(stripeReturn, cardState(status)).text}</Note>
        )}
        {cardReady ? (
          <Text style={{ color: '#22c55e', fontFamily: fonts.bodySemi, fontSize: 15 }}>{STRIPE_CARDS_ON}</Text>
        ) : Platform.OS === 'web' && status?.detailsSubmitted ? (
          <Note tone="warn">{STRIPE_VERIFYING}</Note>
        ) : connected ? (
          <Note tone="warn">{STRIPE_NEEDS_DETAILS}</Note>
        ) : null}
        {!!cardNote && !cardReady && <Note tone="warn">{cardNote}</Note>}
        {checking && <ActivityIndicator color={colors.accent} />}
        {!cardReady && (
          <Button
            title={connected ? 'Finish setup with Stripe' : 'Connect cards with Stripe'}
            size="sm"
            onPress={() => void connectCards()}
            loading={stripeBusy}
          />
        )}
      </Card>
    </>
  );
}
