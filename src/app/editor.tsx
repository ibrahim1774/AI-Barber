import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import type { WebsiteData } from '@/web/types';
import { colors, fonts } from '@/constants/theme';
import { track } from '@/lib/analytics';
import { getPath, setPath } from '@/lib/editable';
import {
  applyBookingLink, applyHomePrompts, fieldLabel, markSeen, nextOverlay, setColour, switchDesign, type Overlay,
} from '@/lib/editor';
import { pickAndUploadPhoto } from '@/lib/photos';
import { loadSite, saveSite, type SiteRecord } from '@/lib/siteStore';
import SitePreview from '@/components/SitePreview';
import { DesignSwitcher } from '@/components/DesignSwitcher';
import { EditSheet } from '@/components/EditSheet';
import { AllFieldsSheet, PhotosSheet } from '@/components/AllFieldsSheet';
import { ColourSheet } from '@/components/ColourSheet';
import { HomePrompts } from '@/components/HomePrompts';
import { LaunchGuide } from '@/components/LaunchGuide';
import { PublishBar } from '@/components/PublishBar';

type SheetKind = 'fields' | 'photos' | 'colour' | 'edit';

export default function Editor() {
  const insets = useSafeAreaInsets();
  const [site, setSite] = useState<SiteRecord | null>(null);
  // The latest record, so slow work (a photo upload, a scrape) applies its
  // change on top of whatever was edited meanwhile, never on a stale copy.
  const siteRef = useRef<SiteRecord | null>(null);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  // Kept after the edit sheet closes so its label/value don't blank mid-slide.
  const [edit, setEdit] = useState<{ path: string; fromList: boolean }>({ path: 'shopName', fromList: false });
  const [uploading, setUploading] = useState(false);
  const uploadingRef = useRef(false);
  const [switching, setSwitching] = useState(false);
  const afterDismiss = useRef<(() => void) | null>(null);

  useEffect(() => {
    track('editor_opened');
    let alive = true;
    loadSite().then(async (s) => {
      if (!alive) return;
      if (!s) {
        router.replace('/start');
        return;
      }
      siteRef.current = s;
      setSite(s);
      const o = await nextOverlay(s);
      if (alive) setOverlay(o);
    });
    return () => {
      alive = false;
    };
  }, []);

  /** Every change goes through here: new record, state, and saveSite. */
  const commitRecord = useCallback((change: (r: SiteRecord) => SiteRecord) => {
    const cur = siteRef.current;
    if (!cur) return;
    const next = { ...change(cur), updatedAt: Date.now() };
    siteRef.current = next;
    setSite(next);
    saveSite(next).catch((e) => console.warn('[editor] save failed:', e));
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
      setUploading(true);
      try {
        const url = await pickAndUploadPhoto(`ios-drafts/${cur.draftId}`);
        if (url) commit((d) => setPath(d, path, url));
      } catch (e: any) {
        Alert.alert('Photo upload failed', e?.message ?? 'Please try again.');
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
  const onPreviewText = useCallback((path: string) => openEdit(path), [openEdit]);

  // From "All fields", closing the edit sheet goes back to the list.
  const closeEdit = useCallback(() => {
    if (edit.fromList) closeThen(() => setSheet('fields'));
    else setSheet(null);
  }, [closeThen, edit.fromList]);

  const handleDesign = useCallback(
    (t: 'luxe' | 'prime') => {
      setSwitching(true);
      commit((d) => switchDesign(d, t));
      setTimeout(() => setSwitching(false), 850);
    },
    [commit],
  );

  // HomePrompts → handleHomePromptBookingLink / handleHomePromptFinish. Like
  // the web's applyGeneratedData, the inputs follow the new name/area/phone.
  const handleBookingLink = useCallback(
    async (link: string) => {
      const cur = siteRef.current;
      if (!cur) return false;
      const rebuilt = await applyBookingLink(cur.data, link);
      if (!rebuilt) return false;
      commitRecord((r) => ({
        ...r,
        data: rebuilt,
        inputs: { ...r.inputs, shopName: rebuilt.shopName, area: rebuilt.area, phone: rebuilt.phone },
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

  // Each overlay's flag is written when it finishes, then the next one shows.
  const finishOverlay = useCallback(async (kind: Overlay) => {
    const cur = siteRef.current;
    if (!cur) return;
    await markSeen(kind, cur.draftId).catch(() => {});
    setOverlay(await nextOverlay(cur));
  }, []);
  const onPromptsComplete = useCallback(() => void finishOverlay('prompts'), [finishOverlay]);
  const onGuideClose = useCallback(() => void finishOverlay('guide'), [finishOverlay]);

  const handlePublish = useCallback(() => {
    // Task 8 replaces this with the Superwall paywall + publish flow.
    track('publish_tapped');
    router.push('/publishing');
  }, []);

  if (!site) return <View style={styles.root} />;

  const data = site.data;
  const editValue = getPath(data, edit.path);

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.preview}>
        <SitePreview data={data} editable onEditText={onPreviewText} onEditImage={pickPhoto} />
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
        onEdit={() => setSheet('fields')}
        onPhotos={() => setSheet('photos')}
        onColour={() => setSheet('colour')}
        onPublish={handlePublish}
        disabled={uploading}
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
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  preview: { flex: 1 },
  uploading: {
    position: 'absolute', alignSelf: 'center', top: '45%',
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 18, paddingVertical: 12, borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.8)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  uploadingText: { fontFamily: fonts.bodySemi, fontSize: 13, color: '#fff' },
});
