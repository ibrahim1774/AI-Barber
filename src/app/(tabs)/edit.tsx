import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import type { WebsiteData } from '@/web/types';
import { colors, fonts } from '@/constants/theme';
import { track } from '@/lib/analytics';
import { hasEntitlement, useSuperwallSettled } from '@/lib/paywall';
import { getPath, setPath } from '@/lib/editable';
import { applyBookingLink, applyHomePrompts, fieldLabel, setColour, switchDesign } from '@/lib/editor';
import { advanceOverlay, hasSeen, markSeen, nextOverlay, type Overlay } from '@/lib/overlayFlags';
import { pickAndUploadPhoto } from '@/lib/photos';
import { takePublishRequest } from '@/lib/publishRequest';
import { askReminderPermissionOnce, refreshReminders } from '@/lib/reminders';
import { loadSite, saveSite, type SiteRecord } from '@/lib/siteStore';
import { tabBarStyle } from '@/lib/tabBar';
import SitePreview from '@/components/SitePreview';
import { DesignSwitcher } from '@/components/DesignSwitcher';
import { EditSheet } from '@/components/EditSheet';
import { AllFieldsSheet, PhotosSheet } from '@/components/AllFieldsSheet';
import { ColourSheet } from '@/components/ColourSheet';
import { HomePrompts } from '@/components/HomePrompts';
import { LaunchGuide } from '@/components/LaunchGuide';
import { PublishBar } from '@/components/PublishBar';

type SheetKind = 'fields' | 'photos' | 'colour' | 'edit';

/** The Edit tab: the site preview with tap-to-edit, the design switcher, and the tool bar with Publish. */
export default function Editor() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [site, setSite] = useState<SiteRecord | null>(null);
  // The latest record, so slow work (a photo upload, a scrape) applies its
  // change on top of whatever was edited meanwhile, never on a stale copy.
  const siteRef = useRef<SiteRecord | null>(null);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
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
    if (!siteRef.current || overlayRef.current || uploadingRef.current) return;
    if (takePublishRequest()) handlePublish();
  }, [handlePublish]);

  // Load (or reload, for a different draft) the record. The overlay is
  // resolved before anything shows, so the editor is never interactive while
  // the prompts / guide are still to come.
  const openRecord = useCallback(async (s: SiteRecord, isAlive: () => boolean) => {
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
      let alive = true;
      loadSite().then((s) => {
        const cur = siteRef.current;
        if (!alive || !s || !cur) return;
        if (s.draftId !== cur.draftId) {
          void openRecord(s, () => alive);
          return;
        }
        if (s.slug !== cur.slug || s.deployedUrl !== cur.deployedUrl || s.transactionId !== cur.transactionId) {
          const next = { ...cur, slug: s.slug, deployedUrl: s.deployedUrl, transactionId: s.transactionId };
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

  // No leaving for Settings until the overlay is resolved and finished, or
  // while a photo uploads (Delete or Restore there would race the save).
  const tabBarHidden = site == null || overlay != null || uploading;
  useLayoutEffect(() => {
    navigation.setOptions({ tabBarStyle: tabBarStyle(tabBarHidden) });
  }, [navigation, tabBarHidden]);

  /** Every change goes through here: new record, state, and saveSite. */
  const commitRecord = useCallback((change: (r: SiteRecord) => SiteRecord) => {
    const cur = siteRef.current;
    if (!cur) return;
    const next = { ...change(cur), updatedAt: Date.now() };
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
  // The guide closing is the moment to ask for publish reminders (once ever;
  // later closes only refresh them). Not before Superwall has settled: its
  // debug build traps on a system prompt during configure.
  const settled = useSuperwallSettled();
  const onGuideClose = useCallback(() => {
    void finishOverlay('guide').then(async () => {
      if (settled) await askReminderPermissionOnce();
      else await refreshReminders();
    });
  }, [finishOverlay, settled]);

  if (!site) return <View style={styles.root} />;

  const data = site.data;
  const editValue = getPath(data, edit.path);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* The prompts / guide cover this body; the tab bar is hidden meanwhile. */}
      <View style={styles.body}>
        <View style={styles.preview}>
          <SitePreview data={data} editable onEditText={onPreviewText} onEditImage={onPreviewImage} />
          {/* Hidden over a published site and while the prompts / guide are up. */}
          {site.slug == null && overlay == null && (
            <DesignSwitcher current={data.template} onSelect={handleDesign} busy={switching} />
          )}
          {uploading && (
            <View style={styles.uploading} pointerEvents="none">
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.uploadingText}>Uploading photo…</Text>
            </View>
          )}
        </View>

        <PublishBar
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
