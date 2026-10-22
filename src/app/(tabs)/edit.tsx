import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import type { WebsiteData } from '@/web/types';
import { colors, fonts } from '@/constants/theme';
import { syncQuietly, takeNotice, withDiskVersion } from '@/lib/adminSync';
import { onSiteAdopted } from '@/lib/siteEvents';
import { track } from '@/lib/analytics';
import { useEntitlements } from '@/lib/entitlements';
import { hasEntitlement } from '@/lib/paywall';
import { bookingPrefs, resolveLinks } from '@/lib/bookingChoice';
import { syncOwnLink } from '@/lib/bookingChoice';
import { useLinkContext } from '@/lib/linkContext';
import { stripLapsedLinks } from '@/lib/tierLinks';
import { getPath, previewBackground, setPath } from '@/lib/editable';
import { applyBookingLink, applyHomePrompts, editorRecord, fieldLabel, setColour, stockPhotoPaths, switchDesign } from '@/lib/editor';
import { StockPhotoNudge } from '@/components/StockPhotoNudge';
import { advanceOverlay, hasSeen, markSeen, nextOverlay, type Overlay } from '@/lib/overlayFlags';
import { pickAndUploadPhoto } from '@/lib/photos';
import { takePublishRequest } from '@/lib/publishRequest';
import { refreshReminders } from '@/lib/reminders';
import { useRestoreFlow } from '@/lib/restoreFlow';
import { loadSite, saveSite, type SiteRecord } from '@/lib/siteStore';
import {
  getSubscriptionStatus, isLocked, recheckSubscriptionStatus, useSubscriptionStatus,
} from '@/lib/subscriptionStatus';
import { tabBarStyle } from '@/lib/tabBar';
import SitePreview from '@/components/SitePreview';
import { DesignSwitcher } from '@/components/DesignSwitcher';
import { EditSheet } from '@/components/EditSheet';
import { AllFieldsSheet, PhotosSheet } from '@/components/AllFieldsSheet';
import { ColourSheet } from '@/components/ColourSheet';
import { SectionsSheet } from '@/components/sections/SectionsSheet';
import { ServicesSheet } from '@/components/sections/ServicesSheet';
import { BookingsServicesSheet } from '@/components/setup/BookingsServicesSheet';
import { loadMyShop, type Shop } from '@/lib/shop';
import { withMirroredServices } from '@/lib/setup/servicesMap';
import { HoursSheet } from '@/components/sections/HoursSheet';
import { TeamSheet } from '@/components/sections/TeamSheet';
import { GallerySheet } from '@/components/sections/GallerySheet';
import { AboutSheet } from '@/components/sections/AboutSheet';
import { ContactSheet } from '@/components/sections/ContactSheet';
import type { SectionKey } from '@/lib/sections/list';
import { HomePrompts } from '@/components/HomePrompts';
import { LaunchGuide } from '@/components/LaunchGuide';
import { PublishBar } from '@/components/PublishBar';
import { LapsedCard } from '@/components/LapsedCard';

type SheetKind = 'fields' | 'photos' | 'colour' | 'edit' | 'sections' | SectionKey;

/**
 * The Edit tab: the site preview with tap-to-edit, the design switcher, and
 * the tool bar with Publish. A published site whose subscription has lapsed
 * gets the LapsedCard instead (Resubscribe, Restore purchases).
 */
export default function Editor() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [site, setSite] = useState<SiteRecord | null>(null);
  const ents = useEntitlements();
  // The preview drops Book / Shop links the plan no longer covers (as the publish will). Never saved over the barber's data.
  const siteData = site?.data;
  const linkCtx = useLinkContext(site?.updatedAt);
  const siteInputs = site?.inputs;
  const previewData = useMemo(
    () =>
      siteData
        ? linkCtx
          ? resolveLinks(siteData, siteInputs, linkCtx)
          : stripLapsedLinks(siteData, ents, bookingPrefs({ data: siteData, inputs: siteInputs ?? {} }).own)
        : null,
    [siteData, siteInputs, ents, linkCtx],
  );
  const subscription = useSubscriptionStatus();
  const locked = isLocked(site, subscription);
  // For the callbacks below: a locked tab runs a publish request whatever the overlay.
  const lockedRef = useRef(false);
  lockedRef.current = locked;
  const { restore, busy: restoring } = useRestoreFlow();
  // The latest record, so slow work (a photo upload, a scrape) applies its
  // change on top of whatever was edited meanwhile, never on a stale copy.
  const siteRef = useRef<SiteRecord | null>(null);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  // The bookings shop, when there is one: then ab_services is the services source.
  const [shop, setShop] = useState<Shop | null>(null);
  // Mirrors `overlay` for the preview callbacks: no edits while one is up.
  const overlayRef = useRef<Overlay | null>(null);
  overlayRef.current = overlay;
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  // Kept after the edit sheet closes so its label/value don't blank mid-slide.
  const [edit, setEdit] = useState<{ path: string; fromList: boolean }>({ path: 'shopName', fromList: false });
  const [uploading, setUploading] = useState(false);
  const uploadingRef = useRef(false);
  const mountedRef = useRef(true);
  useEffect(() => () => { mountedRef.current = false; }, []);
  const [switching, setSwitching] = useState(false);
  const switchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const afterDismiss = useRef<(() => void) | null>(null);
  const saveErrorShown = useRef(false);
  const publishing = useRef(false);

  // /publishing shows the paywall over the editor, then publishes.
  const handlePublish = useCallback(() => {
    if (publishing.current) return; // double tap
    publishing.current = true;
    // entitled: a subscriber's republish is not sent to AppsFlyer as a checkout.
    track('publish_tapped', { entitled: hasEntitlement() });
    router.push('/publishing');
  }, []);

  // Settings' "Publish" (unpublished site): run it here, once the editor is
  // ready, through the same handlePublish. Left for a later check otherwise.
  const runPublishRequest = useCallback(() => {
    if (!siteRef.current || uploadingRef.current || (overlayRef.current && !lockedRef.current)) return;
    if (takePublishRequest()) handlePublish();
  }, [handlePublish]);

  // Load (or reload, for a different draft) the record. The overlay is
  // resolved before anything shows, so the editor is never interactive while
  // the prompts / guide are still to come.
  const openRecord = useCallback(async (raw: SiteRecord, isAlive: () => boolean) => {
    // Shown and edited as the published page renders it (old invented copy removed).
    const s = editorRecord(raw);
    const o = await nextOverlay(s);
    if (!isAlive()) return;
    siteRef.current = s;
    overlayRef.current = o;
    setOverlay(o);
    setSite(s);
    runPublishRequest();
  }, [runPublishRequest]);

  useEffect(() => {
    track('editor_opened');
    let alive = true;
    loadSite().then(async (s) => {
      if (!alive) return;
      if (!s) {
        router.replace('/start');
        return;
      }
      await openRecord(s, () => alive);
    });
    return () => {
      alive = false;
      if (switchTimer.current) clearTimeout(switchTimer.current);
    };
  }, [openRecord]);

  // Coming back from /publishing, /live or Settings re-arms the Publish button
  // and picks up the publish result (slug hides the design switcher), keeping
  // any edits. A different draft (a restore from Settings) reloads the editor.
  useFocusEffect(
    useCallback(() => {
      publishing.current = false;
      // Back on a locked tab (from the paywall, Settings, the background): look again now.
      if (getSubscriptionStatus() === 'lapsed') recheckSubscriptionStatus(true);
      let alive = true;
      loadMyShop().then((sh) => alive && setShop(sh)).catch(() => {});
      // An admin edit made from the server is adopted in the background (the
      // onSiteAdopted subscriber below reloads the editor). Silent on any
      // failure, never blocks editing. A notice left from launch is shown here.
      void syncQuietly().then(() => { if (alive) void showNotice(); });
      loadSite().then((s) => {
        const cur = siteRef.current;
        if (!alive || !s || !cur) return;
        if (s.draftId !== cur.draftId || (s.editedBy === 'admin' && s.serverVersion !== cur.serverVersion)) {
          // A different draft (restore), or an admin edit adopted at launch: reload on it.
          void openRecord(s, () => alive);
          return;
        }
        if (
          s.slug !== cur.slug || s.deployedUrl !== cur.deployedUrl || s.transactionId !== cur.transactionId ||
          JSON.stringify(s.liveLinks) !== JSON.stringify(cur.liveLinks)
        ) {
          // The publish result, including what the live site now shows (the setup screens' prompt reads it).
          const next = { ...cur, slug: s.slug, deployedUrl: s.deployedUrl, transactionId: s.transactionId, liveLinks: s.liveLinks };
          siteRef.current = next;
          setSite(next);
        }
        // The version bookkeeping a publish (or a version learn) saved, so the next edit doesn't write the old one back.
        const versioned = withDiskVersion(siteRef.current!, s);
        if (versioned) {
          siteRef.current = versioned;
          setSite(versioned);
        }
        // The Bookings setup (a screen over this tab) can switch the Book button or
        // mirror services into the saved site: take those two, nothing else.
        if (
          s.updatedAt > cur.updatedAt &&
          (s.data.bookingUrl !== cur.data.bookingUrl || JSON.stringify(s.data.services) !== JSON.stringify(cur.data.services))
        ) {
          const next = {
            ...siteRef.current!,
            data: { ...siteRef.current!.data, bookingUrl: s.data.bookingUrl, services: s.data.services },
            inputs: {
              ...siteRef.current!.inputs,
              bookingUrl: s.inputs.bookingUrl,
              ownBookingUrl: s.inputs.ownBookingUrl,
              ownBookingCleared: s.inputs.ownBookingCleared,
              bookingChoice: s.inputs.bookingChoice,
            },
            updatedAt: s.updatedAt,
          };
          siteRef.current = next;
          setSite(next);
        }
        runPublishRequest();
      });
      return () => {
        alive = false;
        // A request that couldn't run (mid-upload) is dropped, never run on a later visit.
        takePublishRequest();
      };
    }, [openRecord, runPublishRequest]),
  );

  // Tells the barber an admin edit was adopted (the message lives on the record until shown).
  const showNotice = useCallback(async () => {
    if (!mountedRef.current) return;
    const n = await takeNotice();
    // Whatever happened, a later edit must not write the flag back.
    if (siteRef.current?.noticePending) siteRef.current = { ...siteRef.current, noticePending: undefined };
    if (!n || !mountedRef.current) return;
    Alert.alert('Site updated', n);
  }, []);

  // A newer copy loaded from the account or from an admin edit (launch, sign-in,
  // focus, foreground, publish): show it. Not under an open sheet or a photo
  // upload; it is applied when they are done.
  const deferred = useRef<SiteRecord | null>(null);
  const aliveRef = useRef(true);
  const applyAdopted = useCallback((s: SiteRecord) => {
    void openRecord(s, () => aliveRef.current).then(() => showNotice());
  }, [openRecord, showNotice]);
  useEffect(() => {
    aliveRef.current = true;
    const unsubscribe = onSiteAdopted((s) => {
      if (sheetOpenRef.current || uploadingRef.current) deferred.current = s;
      else applyAdopted(s);
    });
    return () => {
      aliveRef.current = false;
      unsubscribe();
    };
  }, [applyAdopted]);
  const sheetOpenRef = useRef(false);
  sheetOpenRef.current = sheet != null;
  useEffect(() => {
    if (sheet != null || uploading || !deferred.current) return;
    const s = deferred.current;
    deferred.current = null;
    applyAdopted(s);
  }, [sheet, uploading, applyAdopted]);

  useEffect(() => {
    if (!locked) return;
    track('subscription_lapsed_shown', { screen: 'edit' });
    // No sheet reappears over the editor once it unlocks.
    setSheet(null);
  }, [locked]);

  const resubscribe = useCallback(() => {
    track('resubscribe_tapped', { screen: 'edit' });
    handlePublish();
  }, [handlePublish]);

  // No leaving for Settings until the overlay is resolved and finished, or
  // while a photo uploads (Delete or Restore there would race the save).
  // Locked, Settings stays reachable (account, restore, delete).
  const tabBarHidden = site == null || (!locked && (overlay != null || uploading));
  useLayoutEffect(() => {
    navigation.setOptions({ tabBarStyle: tabBarStyle(tabBarHidden) });
  }, [navigation, tabBarHidden]);

  /** Every change goes through here: new record, state, and saveSite. */
  const commitRecord = useCallback((change: (r: SiteRecord) => SiteRecord) => {
    const cur = siteRef.current;
    // An adopted copy is waiting for this sheet to close; an edit made now would be replaced by it.
    if (!cur || deferred.current) return;
    // A changed Book link is the barber's own link (Contact edit, or a rebuilt-from-link site).
    const next = { ...syncOwnLink(cur, change(cur)), updatedAt: Date.now() };
    siteRef.current = next;
    setSite(next);
    saveSite(next).catch((e) => {
      console.warn('[editor] save failed:', e);
      if (saveErrorShown.current) return;
      saveErrorShown.current = true;
      Alert.alert("Couldn't save your last change. Check your storage and try again.");
    });
  }, []);

  const commit = useCallback(
    (change: (d: WebsiteData) => WebsiteData) => commitRecord((r) => ({ ...r, data: change(r.data) })),
    [commitRecord],
  );

  // iOS can't present a sheet (or the photo picker) while another sheet is
  // still sliding away: close the open one, then run `next` from onDismiss.
  const closeThen = useCallback((next: () => void) => {
    afterDismiss.current = next;
    setSheet(null);
  }, []);
  const onSheetDismiss = useCallback(() => {
    const next = afterDismiss.current;
    afterDismiss.current = null;
    next?.();
  }, []);

  const pickPhoto = useCallback(
    async (path: string) => {
      const cur = siteRef.current;
      if (!cur || uploadingRef.current) return;
      uploadingRef.current = true;
      try {
        const url = await pickAndUploadPhoto(`ios-drafts/${cur.draftId}`, () => {
          setUploading(true);
          AccessibilityInfo.announceForAccessibility('Uploading photo');
        });
        // Skip if the screen went away (delete) or another draft (restore) took over.
        if (url && mountedRef.current && siteRef.current?.draftId === cur.draftId) {
          commit((d) => setPath(d, path, url));
          AccessibilityInfo.announceForAccessibility('Photo updated');
        }
      } catch (e) {
        console.warn('[editor] photo upload failed:', e);
        Alert.alert('Photo upload failed', 'Please try again or pick a different photo.');
      } finally {
        uploadingRef.current = false;
        setUploading(false);
      }
    },
    [commit],
  );

  // Section photo uploads (Services, Team, Gallery) go through the same guard
  // as pickPhoto: Publish and the tab bar wait, and a result for a screen that
  // went away or another draft is dropped (null).
  const uploadForSection = useCallback(
    async (onPicked?: () => void): Promise<string | null> => {
      const cur = siteRef.current;
      if (!cur || uploadingRef.current) return null;
      uploadingRef.current = true;
      try {
        const url = await pickAndUploadPhoto(`ios-drafts/${cur.draftId}`, () => {
          setUploading(true);
          AccessibilityInfo.announceForAccessibility('Uploading photo');
          onPicked?.();
        });
        return url && mountedRef.current && siteRef.current?.draftId === cur.draftId ? url : null;
      } finally {
        uploadingRef.current = false;
        if (mountedRef.current) setUploading(false);
      }
    },
    [],
  );

  const openEdit = useCallback((path: string, fromList = false) => {
    setEdit({ path, fromList });
    setSheet('edit');
  }, []);
  const onPreviewText = useCallback((path: string) => {
    if (!overlayRef.current) openEdit(path);
  }, [openEdit]);
  const onPreviewImage = useCallback((path: string) => {
    if (!overlayRef.current) void pickPhoto(path);
  }, [pickPhoto]);

  // From "All fields", closing the edit sheet goes back to the list.
  const closeEdit = useCallback(() => {
    if (edit.fromList) closeThen(() => setSheet('fields'));
    else setSheet(null);
  }, [closeThen, edit.fromList]);

  // The Sections list: each card closes the list, then opens its editor
  // (every SectionKey is also a SheetKind).
  const openSection = useCallback((key: SectionKey) => {
    track('section_opened', { section: key });
    closeThen(() => setSheet(key));
  }, [closeThen]);
  const openSections = useCallback(() => {
    track('sections_opened');
    setSheet('sections');
  }, []);

  const handleDesign = useCallback(
    (t: 'luxe' | 'prime') => {
      setSwitching(true);
      commit((d) => switchDesign(d, t));
      if (switchTimer.current) clearTimeout(switchTimer.current);
      switchTimer.current = setTimeout(() => setSwitching(false), 850);
    },
    [commit],
  );

  // HomePrompts → handleHomePromptBookingLink / handleHomePromptFinish. Like
  // the web's applyGeneratedData, the inputs follow the new name/area/phone;
  // a rebuilt-from-link site is marked as a booking import for attribution.
  const handleBookingLink = useCallback(
    async (link: string) => {
      const cur = siteRef.current;
      if (!cur) return false;
      const rebuilt = await applyBookingLink(cur.data, link);
      if (!rebuilt) return false;
      commitRecord((r) => ({
        ...r,
        data: rebuilt,
        inputs: {
          ...r.inputs,
          shopName: rebuilt.shopName,
          area: rebuilt.area,
          phone: rebuilt.phone,
          bookingUrl: rebuilt.bookingUrl,
          importedFrom: 'booking',
        },
      }));
      return true;
    },
    [commitRecord],
  );

  const handlePromptFinish = useCallback(
    (area: string, phone: string) => {
      const cur = siteRef.current;
      if (!cur) return;
      applyHomePrompts(cur.data, area, phone).then((data) =>
        commitRecord((r) => ({
          ...r,
          data,
          inputs: { ...r.inputs, shopName: data.shopName, area: data.area, phone: data.phone },
        })),
      );
    },
    [commitRecord],
  );

  // Each overlay's flag is written when it finishes; the next step is decided
  // in memory, so a failed write can't bring the same overlay straight back.
  const finishOverlay = useCallback(async (kind: Overlay) => {
    const cur = siteRef.current;
    if (!cur) return;
    try {
      await markSeen(kind, cur.draftId);
    } catch (e) {
      console.warn(`[editor] could not save the ${kind} flag:`, e);
    }
    const guideSeen = kind === 'guide' || (await hasSeen('guide', cur.draftId));
    setOverlay(advanceOverlay(kind, guideSeen));
  }, []);
  const onPromptsComplete = useCallback(() => void finishOverlay('prompts'), [finishOverlay]);
  // The guide closing refreshes the reminders (a draft now exists: 'finish'
  // copy). The permission itself is asked at launch (LaunchPrompts in _layout).
  const onGuideClose = useCallback(() => {
    void finishOverlay('guide').then(() => refreshReminders());
  }, [finishOverlay]);

  if (!site) return <View style={styles.root} />;

  if (locked) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <LapsedCard onResubscribe={resubscribe} onRestore={() => void restore()} restoring={restoring} />
      </View>
    );
  }

  const data = site.data;
  const editValue = getPath(data, edit.path);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* The prompts / guide cover this body; the tab bar is hidden meanwhile. */}
      <View style={styles.body}>
        {/* The site's own background, so nothing else shows around the page. */}
        <View style={[styles.preview, { backgroundColor: previewBackground(data) }]}>
          <SitePreview data={previewData ?? data} editable onEditText={onPreviewText} onEditImage={onPreviewImage} />
          {/* Hidden over a published site and while the prompts / guide are up. */}
          {site.slug == null && !site.deployedUrl && overlay == null && (
            <DesignSwitcher current={data.template} onSelect={handleDesign} busy={switching} />
          )}
          {uploading && (
            <View style={styles.uploading} pointerEvents="none">
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.uploadingText}>Uploading photo…</Text>
            </View>
          )}
        </View>

        {overlay == null && stockPhotoPaths(data).length > 0 && (
          <StockPhotoNudge onAddPhotos={() => setSheet('photos')} />
        )}
        <PublishBar
          onSections={openSections}
          onText={() => setSheet('fields')}
          onPhotos={() => setSheet('photos')}
          onColour={() => setSheet('colour')}
          onPublish={handlePublish}
          disabled={uploading || overlay != null}
          padBottom={tabBarHidden}
        />

        <AllFieldsSheet
          visible={sheet === 'fields'}
          data={data}
          onPick={(path) => closeThen(() => openEdit(path, true))}
          onClose={() => setSheet(null)}
          onDismiss={onSheetDismiss}
        />
        <PhotosSheet
          visible={sheet === 'photos'}
          data={data}
          onPick={(path) => closeThen(() => pickPhoto(path))}
          onClose={() => setSheet(null)}
          onDismiss={onSheetDismiss}
        />
        <ColourSheet
          visible={sheet === 'colour'}
          current={data.colorTheme}
          onPick={(hex) => commit((d) => setColour(d, hex))}
          onClose={() => setSheet(null)}
        />
        <SectionsSheet
          visible={sheet === 'sections'}
          data={data}
          onOpen={openSection}
          onClose={() => setSheet(null)}
          onDismiss={onSheetDismiss}
        />
        {shop ? (
          <BookingsServicesSheet
            visible={sheet === 'services'}
            shop={shop}
            onServices={(list) => commit((d) => withMirroredServices(d, list))}
            onClose={() => closeThen(() => setSheet('sections'))}
            onDismiss={onSheetDismiss}
            upload={uploadForSection}
          />
        ) : (
          <ServicesSheet
            visible={sheet === 'services'}
            data={data}
            onChange={commit}
            onClose={() => closeThen(() => setSheet('sections'))}
            onDismiss={onSheetDismiss}
            upload={uploadForSection}
          />
        )}
        <HoursSheet
          visible={sheet === 'hours'}
          data={data}
          onChange={commit}
          onClose={() => closeThen(() => setSheet('sections'))}
          onDismiss={onSheetDismiss}
        />
        <TeamSheet
          visible={sheet === 'team'}
          data={data}
          onChange={commit}
          onClose={() => closeThen(() => setSheet('sections'))}
          onDismiss={onSheetDismiss}
          upload={uploadForSection}
        />
        <GallerySheet
          visible={sheet === 'gallery'}
          data={data}
          onChange={commit}
          onClose={() => closeThen(() => setSheet('sections'))}
          onDismiss={onSheetDismiss}
          upload={uploadForSection}
        />
        <AboutSheet
          visible={sheet === 'about'}
          data={data}
          onChange={commit}
          onClose={() => closeThen(() => setSheet('sections'))}
          onDismiss={onSheetDismiss}
        />
        <ContactSheet
          visible={sheet === 'contact'}
          data={data}
          onChange={commit}
          onClose={() => closeThen(() => setSheet('sections'))}
          onDismiss={onSheetDismiss}
        />
        <EditSheet
          visible={sheet === 'edit'}
          path={edit.path}
          label={fieldLabel(edit.path)}
          value={typeof editValue === 'string' ? editValue : ''}
          onSave={(v) => commit((d) => setPath(d, edit.path, v))}
          onClose={closeEdit}
          onDismiss={onSheetDismiss}
        />

        {overlay === 'prompts' && (
          <HomePrompts
            onSubmitBookingLink={handleBookingLink}
            onFinish={handlePromptFinish}
            onComplete={onPromptsComplete}
            initialArea={data.area || ''}
            initialPhone={data.phone || ''}
          />
        )}
        {overlay === 'guide' && <LaunchGuide onClose={onGuideClose} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  preview: { flex: 1 },
  uploading: {
    position: 'absolute', alignSelf: 'center', top: '45%',
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 18, paddingVertical: 12, borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.8)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  uploadingText: { fontFamily: fonts.bodySemi, fontSize: 13, color: '#fff' },
});
