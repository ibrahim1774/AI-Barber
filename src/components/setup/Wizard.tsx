import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Share, StyleSheet, Text, View } from 'react-native';
import { colors, fonts } from '@/constants/theme';
import { track } from '@/lib/analytics';
import { Button } from '@/components/Button';
import { ShareSheet } from '@/components/ShareSheet';
import { Barbers } from '@/components/setup/Barbers';
import { GetPaid } from '@/components/setup/GetPaid';
import { MemberHours } from '@/components/setup/HoursGrid';
import { ServicesEditorView } from '@/components/setup/ServicesEditor';
import { useServicesEditor } from '@/components/setup/useServicesEditor';
import { Card, Note, Chip, Chips, TextAction } from '@/components/setup/ui';
import { pickAndUploadPhoto } from '@/lib/photos';
import { shareMessage } from '@/lib/share';
import { BookButtonPicker } from '@/components/setup/BookButtonPicker';
import { bookingPrefs, withChoice } from '@/lib/bookingChoice';
import { withMirroredServices } from '@/lib/setup/servicesMap';
import { updateSiteData, updateSiteRecord } from '@/lib/setup/siteSync';
import {
  STEPS, STEP_TITLES, back, currentStep, initialWizard, next, progressLabel, setSwitch, skip, type WizardState,
} from '@/lib/setup/wizard';
import { PLAN_PENDING } from '@/components/setup/SetupHub';
import { registerPushForShop } from '@/lib/setup/relink';
import { markWizardDone } from '@/lib/setup/wizardFlag';
import { bookingUrl, listMembers, updateShopSettings, type Member, type Service, type Shop } from '@/lib/shop';
import type { SiteRecord } from '@/lib/siteStore';

export const WIZARD_PUBLISH_TITLE = 'Bookings are on';
export const WIZARD_PUBLISH_BODY = 'Publish to add the Book button to your website.';

type Props = {
  shop: Shop;
  site: SiteRecord;
  /** Reload the shop after Get Paid changes it. */
  onShopChanged(): void;
  onFinish(): void;
};

/** First-run setup: services, hours, who takes bookings, how you get paid, share. Every step skippable. */
export function Wizard({ shop, site, onShopChanged, onFinish }: Props) {
  const { own } = bookingPrefs(site);
  const [state, setState] = useState<WizardState>(() => initialWizard(own != null));
  const [owner, setOwner] = useState<Member | null>(null);
  const [addBarbers, setAddBarbers] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const hoursSave = useRef<(() => Promise<boolean>) | null>(null);
  const step = currentStep(state);

  useEffect(() => {
    listMembers(shop.id).then((m) => setOwner(m.find((x) => x.role === 'owner') ?? m[0] ?? null)).catch(() => {});
  }, [shop.id]);

  const mirror = useCallback(
    (list: Service[]) => { void updateSiteData((d) => withMirroredServices(d, list)).catch(() => {}); },
    [],
  );
  const services = useServicesEditor(shop, mirror, () => pickAndUploadPhoto(site.draftId));

  const finish = async () => {
    if (finishing) return;
    setFinishing(true);
    try {
      await updateShopSettings(shop.id, { bookingsEnabled: true });
      const saved = await updateSiteRecord((r) => withChoice(r, state.switchBookButton || !bookingPrefs(r).own ? 'aibarber' : 'own', shop));
      await markWizardDone(shop.id);
      void registerPushForShop();
      track('bookings_setup_done', { skipped: state.skipped.length, switched_book_button: state.switchBookButton });
      if (saved && bookingPrefs(saved).choice === 'aibarber') Alert.alert(WIZARD_PUBLISH_TITLE, WIZARD_PUBLISH_BODY);
      onFinish();
    } catch (e) {
      Alert.alert("Couldn't finish setup", e instanceof Error ? e.message : 'Try again.');
    } finally {
      setFinishing(false);
    }
  };

  const advance = async (kind: 'next' | 'skip') => {
    if (kind === 'next' && step === 'hours' && hoursSave.current && !(await hoursSave.current())) return;
    const n = kind === 'next' ? next(state) : skip(state);
    if (n.done) {
      void finish();
      return;
    }
    setState(n);
  };

  const url = bookingUrl(shop);
  return (
    <View>
      <Text style={st.progress}>{progressLabel(state)}</Text>
      <Text style={st.title} accessibilityRole="header">{STEP_TITLES[step]}</Text>

      {step === 'services' && (
        <>
          <Note>Tap a service to set its price. These are the services customers can book.</Note>
          <View style={{ height: 8 }} />
          <ServicesEditorView ed={services} />
          <View style={{ height: 16 }} />
          <BookButtonPicker
            own={own}
            choice={state.switchBookButton ? 'aibarber' : 'own'}
            onChange={(c) => setState((x) => setSwitch(x, c === 'aibarber'))}
          />
        </>
      )}

      {step === 'hours' && (
        <>
          <Note>Default is Tuesday to Saturday, 9 AM to 6 PM. Change any day.</Note>
          {owner ? <MemberHours memberId={owner.id} saveLabel="Save hours" autoSaveRef={hoursSave} /> : null}
        </>
      )}

      {step === 'team' && (
        <>
          <Chips>
            <Chip label="Just me" selected={!addBarbers} onPress={() => setAddBarbers(false)} />
            <Chip label="Add barbers" selected={addBarbers} onPress={() => setAddBarbers(true)} />
          </Chips>
          <View style={{ height: 12 }} />
          {addBarbers ? (
            <Barbers shop={shop} uploadFolder={site.draftId} />
          ) : (
            <Note>Customers book with you. You can add barbers any time from Setup.</Note>
          )}
        </>
      )}

      {step === 'pay' && (
        <GetPaid shop={shop} onChanged={onShopChanged} />
      )}

      {step === 'share' && (
        <>
          <Card title="Your booking link">
            <Text selectable style={st.url}>{url}</Text>
            {!shop.purchaseLinked && <Note tone="warn">{PLAN_PENDING}</Note>}
            <Note>Put it in your Instagram bio, text it to regulars, or show the QR code at the counter.</Note>
            <Button title="Share booking link" size="sm" onPress={() => setShareOpen(true)} />
            <TextAction
              title="Send as a message"
              onPress={() => void Share.share({ message: shareMessage('booking', shop.name, url) })}
            />
          </Card>
          <ShareSheet
            visible={shareOpen}
            shopName={shop.name}
            links={[{ kind: 'booking', url }, ...(site.deployedUrl ? [{ kind: 'website' as const, url: site.deployedUrl }] : [])]}
            source="settings"
            onClose={() => setShareOpen(false)}
          />
        </>
      )}

      <View style={st.nav}>
        <Button
          title={step === STEPS[STEPS.length - 1] ? 'Finish' : 'Continue'}
          onPress={() => void advance('next')}
          loading={finishing}
        />
        <View style={st.navRow}>
          {state.index > 0 ? <TextAction title="Back" onPress={() => setState(back)} /> : <View />}
          {step !== 'share' && <TextAction title="Skip this step" onPress={() => void advance('skip')} />}
        </View>
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  progress: { fontFamily: fonts.bodyBold, fontSize: 11, letterSpacing: 1.6, textTransform: 'uppercase', color: colors.accent },
  title: { fontFamily: fonts.heading, fontSize: 24, color: colors.heading, marginTop: 6, marginBottom: 10 },
  url: { fontFamily: fonts.mono, fontSize: 13, color: colors.accent },
  nav: { marginTop: 24, gap: 8 },
  navRow: { flexDirection: 'row', justifyContent: 'space-between' },
});
