import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AccessibilityInfo, ActivityIndicator, Alert, Platform, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { router, useFocusEffect, useNavigation } from 'expo-router';
import type { WebsiteData } from '@/web/types';
import { colors, fonts } from '@/constants/theme';
import { syncQuietly, takeNotice, withDiskVersion } from '@/lib/adminSync';
import { onSiteAdopted } from '@/lib/siteEvents';
import { track } from '@/lib/analytics';
import { useEntitlements } from '@/lib/entitlements';
import { hasEntitlement } from '@/lib/paywall';
import { bookingPrefs, bookTargetStatus, linksToSend } from '@/lib/bookingChoice';
import { syncOwnLink } from '@/lib/bookingChoice';
import { canOpenAddService, keepServicesAdd, keepServicesFocus, serviceFocusFor } from '@/lib/addServiceGuard';
import { useLinkContext } from '@/lib/linkContext';
import { copyKeyOfPath, copyPathHasWordings, hoursEditorFor, pageForHref, previewBackground, textMaxLength, textValue, type PreviewPage } from '@/lib/editable';
import { navLabelKey } from '@/web/lib/render/labels';
import { PAGE_TITLES, resolvePage, serviceRows, withPageChange, type PagesChange } from '@/lib/sitePages';
import { clearHero, isHeroPath, sampleHeroPaths, setPhoto } from '@/lib/pageHero';
import { isCopyEdited, resetCopy, tryOtherWording } from '@/lib/copyEdit';
import { sectionPageFor } from '@/lib/pageSections';
import { applyBookingLink, applyHomePrompts, editorRecord, fieldLabel, savePathValue, setColour, stockPhotoPaths, switchDesign } from '@/lib/editor';
import { StockPhotoNudge } from '@/components/StockPhotoNudge';
import type { PreviewProduct } from '@/lib/editable';
import { listProducts } from '@/lib/store/data';
import { isSiteShopLink } from '@/web/lib/render/subpages';
import { advanceOverlay, hasSeen, markSeen, nextOverlay, visibleOverlay, type Overlay } from '@/lib/overlayFlags';
import { LogoError, photoFailMessage, pickAndUploadLogo, pickAndUploadPhoto } from '@/lib/photos';
import { LOGO_ENABLED, withHeaderShow, withLogo, withLogoPreview, withoutLogo } from '@/lib/logo';
import type { LogoVerdict } from '@/lib/logoContrast';
import { HeaderSheet } from '@/components/HeaderSheet';
import { bookingsPlanRoute, peekPublishHint, takePublishRequest, type PlanHint } from '@/lib/publishRequest';
import { refreshReminders } from '@/lib/reminders';
import { useRestoreFlow } from '@/lib/restoreFlow';
import { loadPendingPublish, loadSite, saveSite, type SiteRecord } from '@/lib/siteStore';
import {
  getSubscriptionStatus, recheckSubscriptionStatus,
} from '@/lib/subscriptionStatus';
import { tabBarStyle } from '@/lib/tabBar';
import SitePreview from '@/components/SitePreview';
import { PagesSheet } from '@/components/PagesSheet';
import { PageSectionsSheet } from '@/components/PageSectionsSheet';
import { HeroPhotoSheet } from '@/components/HeroPhotoSheet';
import { ColourButton } from '@/components/ColourButton';
import { DesignSwitcher } from '@/components/DesignSwitcher';
import { EditSheet } from '@/components/EditSheet';
import { ButtonSheet, type ButtonChange } from '@/components/ButtonSheet';
import { CALL_LABEL_KEYS, MAIN_BOOK_KEY, chooserLabelKey, routeTap, type CtaKind } from '@/lib/ctaButtons';
import { applyButtonChange } from '@/lib/buttonChange';
import { useUpgrade } from '@/lib/tierAccess';
import { LABELS, defaultLabel, type LabelKey } from '@/web/lib/render/labels';
import { nicheOf } from '@/web/lib/render/honest';
import { AllFieldsSheet, PhotosSheet } from '@/components/AllFieldsSheet';
import { SectionsSheet } from '@/components/sections/SectionsSheet';
import { ServicesSheet } from '@/components/sections/ServicesSheet';
import { BookingsServicesSheet } from '@/components/setup/BookingsServicesSheet';
import { loadMyShop, type Shop } from '@/lib/shop';
import { HoursSheet } from '@/components/sections/HoursSheet';
import { TeamSheet } from '@/components/sections/TeamSheet';
import { GallerySheet } from '@/components/sections/GallerySheet';
import { AboutSheet } from '@/components/sections/AboutSheet';
import { ReviewsSheet } from '@/components/sections/ReviewsSheet';
import { ContactSheet } from '@/components/sections/ContactSheet';
import type { SectionKey } from '@/lib/sections/list';
import { HomePrompts } from '@/components/HomePrompts';
import { SiteReadyNotice } from '@/components/SiteReadyNotice';
import { TutorialLayer } from '@/components/tutorial/TutorialLayer';
import { useTour } from '@/components/tutorial/useTour';
import { useTutorialTarget } from '@/components/tutorial/registry';
import { editTourReady } from '@/components/tutorial/tours';
import { useSession } from '@/lib/auth';
import { migrateSamplePrices, mirrorServices } from '@/lib/samplePrices';
import { WebTips } from '@/components/WebTips';
import { PublishBar } from '@/components/PublishBar';
import { PaymentBlock } from '@/components/PaymentLock';
import { isBlocking, usePaymentLock, type BlockKind } from '@/lib/paymentLock';
import { EditorBackBar, canGoBackToStart } from '@/components/EditorBackBar';

type SheetKind = 'fields' | 'photos' | 'colour' | 'edit' | 'button' | 'sections' | 'pages' | 'pageSections' | 'hero' | 'header' | SectionKey;

/**
 * The Edit tab: the site preview with tap-to-edit, the design switcher, and
 * the tool bar with Publish. A published site whose payment failed or whose subscription
 * ended gets the PaymentBlock instead (Update payment method, check again, Restore purchases).
 */
export default function Editor() {
  const insets = useSafeAreaInsets();
  const navigation = useNavigation();
  const [site, setSite] = useState<SiteRecord | null>(null);
  // The logo just uploaded, as a data URI for the preview only (never saved). Error: the last upload failed, site unchanged.
  const [logoPreview, setLogoPreview] = useState<{ url: string; dataUri: string; contrast: LogoVerdict | null } | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const ents = useEntitlements();
  // The preview drops Book / Shop links the plan no longer covers (as the publish will). Never saved over the barber's data.
  const siteData = site?.data;
  const linkCtx = useLinkContext(site?.updatedAt);
  const siteInputs = site?.inputs;
  const previewData = useMemo(
    () =>
      siteData
        // The same decision a publish makes (linksToSend): the built-in /book (hero, header, contact buttons, the Book
        // online section) only with a live Bookings scheduler; before any plan the preview has none of it.
        ? linksToSend(siteData, siteInputs, linkCtx)
        : null,
    [siteData, siteInputs, ents, linkCtx],
  );
  // The preview shows a just-uploaded logo from its data URI (memoised: a new object would reload the WebView).
  const previewShown = useMemo(() => (previewData ? withLogoPreview(previewData, logoPreview) : null), [previewData, logoPreview]);
  // The data the preview shows, for the menu callback (which must not re-create on every edit).
  const shownRef = useRef<WebsiteData | null>(null);
  shownRef.current = previewData ?? siteData ?? null;
  // The account's own subscription could not be renewed (payment failed / ended / revoked): the editor is blocked.
  // A failed or ended payment blocks (no banner). Uncertain answers (loading, offline, error) never lock.
  const paymentLock = usePaymentLock(site);
  const locked = isBlocking(paymentLock);
  // For the callbacks below: a locked tab runs a publish request whatever the overlay.
  const lockedRef = useRef(false);
  lockedRef.current = locked;
  const { restore, busy: restoring } = useRestoreFlow();
  // The latest record, so slow work (a photo upload, a scrape) applies its
  // change on top of whatever was edited meanwhile, never on a stale copy.
  const siteRef = useRef<SiteRecord | null>(null);
  const previewAliveCheck = useRef<(() => void) | null>(null);
  // "You can edit the text, photos, services and prices": once per generated, unpublished site, after the name prompts.
  const [welcome, setWelcome] = useState(false);
  const welcomeChecked = useRef<string | null>(null);
  const [overlayState, setOverlay] = useState<Overlay | null>(null);
  const { session } = useSession();
  // A paid publish waiting to finish: Back (which discards the draft) is hidden meanwhile. Unknown counts as pending.
  const [pendingPaid, setPendingPaid] = useState(true);
  useFocusEffect(useCallback(() => {
    let alive = true;
    loadPendingPublish().then((p) => alive && setPendingPaid(!!p), () => alive && setPendingPaid(true));
    return () => { alive = false; };
  }, []));
  // The Edit tour (the 'guide' overlay) waits for an account: until then it neither shows nor locks the editor.
  const overlay = visibleOverlay(overlayState, !!session);
  // The bookings shop, when there is one: then ab_services is the services source.
  const [shop, setShop] = useState<Shop | null>(null);
  // The barber's products for the homepage Shop section in the preview (only while it has one).
  const [shopProducts, setShopProducts] = useState<PreviewProduct[] | null>(null);
  const showsShop = isSiteShopLink((previewData as { shopUrl?: string } | null)?.shopUrl);
  const shopId = shop?.id;
  useEffect(() => {
    if (!showsShop || !shopId) {
      setShopProducts(null);
      return;
    }
    let alive = true;
    listProducts(shopId)
      .then((ps) => alive && setShopProducts(ps.filter((p) => !p.soldOut).map((p) => ({ name: p.name, priceCents: p.priceCents, photo: p.photos[0] ?? null }))))
      .catch(() => alive && setShopProducts([]));
    return () => {
      alive = false;
    };
  }, [showsShop, shopId]);
  // Mirrors `overlay` for the preview callbacks: no edits while one is up.
  const overlayRef = useRef<Overlay | null>(null);
  overlayRef.current = overlay;
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  // The Services sheet was opened by the preview's "+ Add a service" button: it starts at the add view and closes to the preview.
  const [servicesAdd, setServicesAdd] = useState(false);
  // ...or by a tap on a service card: it opens at that service (its index in the site's services).
  const [servicesFocus, setServicesFocus] = useState<number | null>(null);
  // The Hours sheet was opened by a tap on the hours list in the preview: it closes back to the preview, not the Sections list.
  const [hoursFromPreview, setHoursFromPreview] = useState(false);
  // The page of a multi-page site the preview shows. Never saved; Home when that page goes away.
  const [wantedPage, setWantedPage] = useState<PreviewPage | null>(null);
  // Kept after the edit sheet closes so its label/value don't blank mid-slide.
  const [edit, setEdit] = useState<{ path: string; fromList: boolean; fromPage?: boolean }>({ path: 'shopName', fromList: false });
  // The call-to-action button being edited (kept after the sheet closes so its content doesn't blank mid-slide).
  const [button, setButton] = useState<{ kind: CtaKind; labelKey: string }>({ kind: 'inSite', labelKey: 'bookButton' });
  const upgrade = useUpgrade('bookings_upgrade');
  // The page hero photo being changed (services.<i>.imageUrl, extraPages.images.<key>).
  const [heroPath, setHeroPath] = useState('');
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
  const publishWith = useCallback((planHint?: PlanHint) => {
    if (publishing.current) return; // double tap
    publishing.current = true;
    // entitled: a subscriber's republish is not sent to AppsFlyer as a checkout.
    track('publish_tapped', { entitled: hasEntitlement() });
    // The plan hint (from the Bookings / Store tab or the Plan row) goes to the publish paywall as its params.
    if (planHint) router.push({ pathname: '/publishing', params: { plan: planHint } });
    else router.push('/publishing');
  }, []);
  const handlePublish = useCallback(() => publishWith(), [publishWith]);
  // Opening the Services editor (sheet, preview tap, + Add a service) is the review: no example-price alert after it.
  useEffect(() => {
    if (sheet === 'services' && siteRef.current && !siteRef.current.inputs.pricesReviewed) {
      commitRecord((r) => ({ ...r, inputs: { ...r.inputs, pricesReviewed: true } }));
    }
  }, [sheet]); // eslint-disable-line react-hooks/exhaustive-deps

  // Settings' "Publish" (unpublished site): run it here, once the editor is
  // ready, through the same handlePublish. Left for a later check otherwise.
  const runPublishRequest = useCallback(() => {
    if (!siteRef.current || uploadingRef.current || (overlayRef.current && !lockedRef.current)) return;
    const hint = peekPublishHint();
    if (takePublishRequest()) publishWith(hint);
  }, [publishWith]);

  // Load (or reload, for a different draft) the record. The overlay is
  // resolved before anything shows, so the editor is never interactive while
  // the prompts / guide are still to come.
  const openRecord = useCallback(async (raw: SiteRecord, isAlive: () => boolean) => {
    // Shown and edited as the published page renders it (old invented copy removed).
    const done = migrateSamplePrices(raw);
    // Saved once, so the flag (and the filled prices) stay and the account row gets them on the next sync.
    const migrated = done === raw ? raw : { ...done, updatedAt: Date.now() };
    if (migrated !== raw) saveSite(migrated).catch(() => {});
    const s = editorRecord(migrated);
    const o = await nextOverlay(s);
    if (!isAlive()) return;
    siteRef.current = s;
    overlayRef.current = o;
    welcomeChecked.current = null; // a freshly generated draft is looked at again (its flag was cleared)
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
  // and picks up the publish result keeping
  // any edits. A different draft (a restore from Settings) reloads the editor.
  useFocusEffect(
    useCallback(() => {
      publishing.current = false;
      // Back on the tab: if iOS ended the preview's process meanwhile, it is rebuilt from the saved site.
      previewAliveCheck.current?.();
      // Back on a locked tab (from the paywall, Settings, the background): look again now.
      if (getSubscriptionStatus() === 'lapsed') recheckSubscriptionStatus(true);
      let alive = true;
      // The same shop again keeps the state object: a new one re-rendered the editor on every tab focus.
      loadMyShop().then((sh) => alive && setShop((prev) => (JSON.stringify(prev) === JSON.stringify(sh) ? prev : sh))).catch(() => {});
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
        // Reviewed in a setup screen (Bookings setup Services step): keep that here so the next save doesn't drop it.
        if (s.inputs.pricesReviewed && !siteRef.current!.inputs.pricesReviewed) {
          const next = { ...siteRef.current!, inputs: { ...siteRef.current!.inputs, pricesReviewed: true as const } };
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
          commit((d) => setPhoto(d, path, url));
          AccessibilityInfo.announceForAccessibility('Photo updated');
        }
      } catch (e) {
        console.warn('[editor] photo upload failed:', e);
        Alert.alert('Photo upload failed', photoFailMessage(e, 'Please try again or pick a different photo.'));
      } finally {
        uploadingRef.current = false;
        setUploading(false);
      }
    },
    [commit],
  );

  // Add / replace the header logo: library -> resized PNG -> upload -> site.logo. Any failure leaves the site as it was.
  const pickLogo = useCallback(async () => {
    const cur = siteRef.current;
    if (!cur || uploadingRef.current) return;
    uploadingRef.current = true;
    setLogoError(null);
    let failed: string | null = null;
    try {
      const up = await pickAndUploadLogo(`ios-drafts/${cur.draftId}`, () => {
        setUploading(true);
        setLogoBusy(true);
        AccessibilityInfo.announceForAccessibility('Uploading logo');
      });
      if (up && mountedRef.current && siteRef.current?.draftId === cur.draftId) {
        setLogoPreview({ url: up.url, dataUri: up.previewUri, contrast: up.contrast?.verdict ?? null });
        commit((d) => withLogo(d, { url: up.url, w: up.w, h: up.h }));
        AccessibilityInfo.announceForAccessibility('Logo updated');
        track('logo_set');
      }
    } catch (e) {
      console.warn('[editor] logo upload failed:', e);
      failed = e instanceof LogoError ? e.message : "Couldn't upload your logo. Check your connection and try again.";
    } finally {
      uploadingRef.current = false;
      if (mountedRef.current) {
        setUploading(false);
        setLogoBusy(false);
      }
    }
    // Back to the header sheet with the reason; the retry is one tap.
    if (failed && mountedRef.current) {
      setLogoError(failed);
      setSheet('header');
    }
  }, [commit]);
  const removeLogo = useCallback(() => {
    commit((d) => withoutLogo(d));
    setLogoPreview(null);
    setLogoError(null);
    track('logo_removed');
  }, [commit]);

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

  const openEdit = useCallback((path: string, fromList = false, fromPage = false) => {
    // Stored hours are 24 hour HH:MM while the page shows 9:00 AM: open / close go to the time pickers, not the text box.
    const hoursEditor = hoursEditorFor(path);
    if (hoursEditor) { setSheet(hoursEditor); return; }
    setEdit({ path, fromList, fromPage });
    setSheet('edit');
  }, []);
  // A tap on a call-to-action button (or the All-fields booking link row) opens the button sheet: its text AND its
  // link. Everything else is the plain text box.
  const openTap = useCallback((path: string, fromList = false) => {
    // The header: its name, or a logo in its place.
    if (path === 'shopName' && LOGO_ENABLED) {
      setLogoError(null);
      setSheet('header');
      return;
    }
    const route = routeTap(path, shownRef.current ?? {});
    if (route.sheet === 'button') {
      track('button_sheet_opened', { kind: route.kind });
      setButton({ kind: route.kind, labelKey: route.kind === 'book' ? chooserLabelKey(shownRef.current?.template, route.labelKey) : route.labelKey });
      setSheet('button');
      return;
    }
    openEdit(path, fromList);
  }, [openEdit]);
  const onPreviewText = useCallback((path: string) => {
    if (!overlayRef.current) openTap(path);
  }, [openTap]);
  const saveButton = useCallback((labelKey: string, change: ButtonChange) => {
    if (change.book) track('book_target_set', { target: change.book.choice === 'aibarber' ? 'scheduler' : 'link' });
    commitRecord((r) => applyButtonChange(r, labelKey, change));
  }, [commitRecord]);
  // A tap on a menu entry in the preview: show that page (never a real navigation). Book and Shop open their editor.
  const onPreviewNav = useCallback((href: string) => {
    if (overlayRef.current) return;
    const d = shownRef.current;
    if (d && (href === '/book' || href === '/shop')) {
      const key = href.slice(1) as 'book' | 'shop';
      track('preview_nav', { page: key });
      onPreviewText(`labels.${navLabelKey(d.template ?? 'luxe', key)}`);
      return;
    }
    const p = d ? pageForHref(d, href) : null;
    if (!p) return;
    track('preview_nav', { page: p.key });
    setWantedPage(p);
  }, [onPreviewText]);
  const openHero = useCallback((path: string) => {
    setHeroPath(path);
    setSheet('hero');
  }, []);
  const onPreviewImage = useCallback((path: string) => {
    if (overlayRef.current) return;
    // A page hero offers the gallery and the sample photo too; every other photo goes straight to the library.
    if (isHeroPath(path)) openHero(path);
    else void pickPhoto(path);
  }, [pickPhoto, openHero]);

  // From "All fields", closing the edit sheet goes back to the list.
  const closeEdit = useCallback(() => {
    if (edit.fromList) closeThen(() => setSheet('fields'));
    else if (edit.fromPage) closeThen(() => setSheet('pageSections'));
    else setSheet(null);
  }, [closeThen, edit.fromList, edit.fromPage]);

  // The Sections list: each card closes the list, then opens its editor
  // (every SectionKey is also a SheetKind).
  // Whatever closes or replaces the Services sheet (the lapse close included) ends the add view.
  useEffect(() => { setServicesAdd((a) => keepServicesAdd(a, sheet)); setServicesFocus((f) => keepServicesFocus(f, sheet)); setHoursFromPreview((h) => h && sheet === 'hours'); }, [sheet]);
  const openSection = useCallback((key: SectionKey) => {
    track('section_opened', { section: key });
    closeThen(() => setSheet(key));
  }, [closeThen]);
  // The editor-only "+ Add a button" under the hero (the site has no Book button): the same chooser a Book button opens.
  const onPreviewAddButton = useCallback(() => {
    if (!canOpenAddService(sheet, overlayRef.current)) return;
    track('add_button_tapped');
    setButton({ kind: 'book', labelKey: MAIN_BOOK_KEY[shownRef.current?.template ?? 'luxe'] ?? 'bookButton' });
    setSheet('button');
  }, [sheet]);
  // A tap on a service card in the preview: the Services sheet (the Bookings one when the site has a shop, where
  // ab_services is the source) at that service, to edit, remove or add another.
  const onPreviewService = useCallback((index: number) => {
    const at = serviceFocusFor(sheet, overlayRef.current, shownRef.current?.services, index);
    if (at == null) return;
    track('service_card_tapped');
    setServicesAdd(false);
    setServicesFocus(at);
    setSheet('services');
  }, [sheet]);
  // A tap on the working-hours list in the preview: the Hours sheet (not the inline text box).
  const onPreviewHours = useCallback(() => {
    if (!canOpenAddService(sheet, overlayRef.current)) return;
    track('hours_tapped');
    setHoursFromPreview(true);
    setSheet('hours');
  }, [sheet]);
  const onPreviewAddService = useCallback(() => {
    if (!canOpenAddService(sheet, overlayRef.current)) return;
    track('add_service_tapped');
    setServicesAdd(true);
    setSheet('services');
  }, [sheet]);
  // The one way into the logo flow (Photos tile, Sections row; a tap on the header opens the same sheet): the Logo & name sheet.
  const openLogo = useCallback(() => closeThen(() => { setLogoError(null); setSheet('header'); }), [closeThen]);
  const openSections = useCallback(() => {
    track('sections_opened');
    setSheet('sections');
  }, []);

  // Saving the Pages sheet writes pages {order, hidden} and, for guide pages, extraPages (the first save is what
  // makes an older site multi-page).
  const savePages = useCallback((change: PagesChange, show?: PreviewPage) => {
    track('pages_saved', { hidden: change.pages.hidden.length, guides: change.extraPages?.on.length ?? 0 });
    commit((d) => withPageChange(d, change));
    setWantedPage(show ?? null);
  }, [commit]);
  const editPlace = useCallback(() => closeThen(() => openEdit('labels.pgPlace')), [closeThen, openEdit]);

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

  useEffect(() => {
    const cur = siteRef.current;
    if (!site || !cur || overlay === 'prompts' || cur.slug != null || cur.deployedUrl) return;
    if (welcomeChecked.current === cur.draftId) return;
    welcomeChecked.current = cur.draftId;
    hasSeen('welcome', cur.draftId).then((seen) => { if (!seen && mountedRef.current) setWelcome(true); });
  }, [site, overlay]);
  const closeWelcome = useCallback(() => {
    setWelcome(false);
    const cur = siteRef.current;
    if (cur) markSeen('welcome', cur.draftId).catch((e) => console.warn('[editor] could not save the welcome flag:', e));
  }, []);

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

  // The first-site guide is the Edit tour (its first step is Publish); a replay from Settings opens it any time.
  const tour = useTour('edit', {
    auto: overlay === 'guide' ? 'edit' : null,
    ignoreFlag: true,
    ready: editTourReady({ overlay, hasSite: !!site, signedIn: !!session }) && !welcome,
    onDone: (id) => {
      if (id === 'edit' && overlayRef.current === 'guide') onGuideClose();
    },
  });

  // Web: the first-site guide (coach marks) never auto-starts, so close it at once; the flow after it (reminders, prompts) goes on.
  const webGuideReady = Platform.OS === 'web' && overlay === 'guide' && editTourReady({ overlay, hasSite: !!site, signedIn: !!session }) && !welcome;
  useEffect(() => {
    if (webGuideReady) onGuideClose();
  }, [webGuideReady, onGuideClose]);

  // The hero's (else the first) "Change image" pill, which the Edit tour's photo step points at.
  const changeImageRef = useTutorialTarget('edit.changeImage');

  if (!site) return <View style={styles.root} />;

  if (locked) {
    return (
      <View style={[styles.root, { paddingTop: insets.top }]}>
        <PaymentBlock kind={paymentLock as BlockKind} screen="edit" onResubscribe={resubscribe} onRestore={() => void restore()} restoring={restoring} />
      </View>
    );
  }

  const data = site.data;
  const editValue = textValue(data, edit.path);
  const shown = previewShown ?? data;
  const page = resolvePage(shown, wantedPage);
  const canEditPage = overlay == null && sectionPageFor(page) !== null;
  const pageTitle = page.index !== undefined && page.key === 'services'
    ? serviceRows(shown).find((r) => r.index === page.index)?.title ?? PAGE_TITLES.services
    : PAGE_TITLES[page.key];
  const editedCopyKey = copyKeyOfPath(edit.path);
  const buttonPath = `labels.${button.labelKey}`;
  const buttonDef = (LABELS as Record<string, { title: string; max: number }>)[button.labelKey];
  const prefs = bookingPrefs({ data, inputs: site.inputs });
  const callKey = CALL_LABEL_KEYS[data.template ?? 'luxe']?.[0];

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* The prompts / guide cover this body; the tab bar is hidden meanwhile. */}
      <View style={styles.body}>
        <EditorBackBar visible={overlay == null && sheet == null && !uploading && canGoBackToStart(site, pendingPaid, !!session)} />
        {/* The site's own background, so nothing else shows around the page. */}
        <View style={[styles.preview, { backgroundColor: previewBackground(data) }]}>
          <SitePreview data={shown} editable page={page} shopProducts={shopProducts} onEditText={onPreviewText} onEditImage={onPreviewImage} onNavigate={onPreviewNav} onAddService={onPreviewAddService} onService={onPreviewService} onHours={onPreviewHours} onAddButton={onPreviewAddButton} pillTourRef={changeImageRef} samplePaths={sampleHeroPaths(shown, page)} chipsHidden={sheet != null} aliveCheckRef={previewAliveCheck} />
          {/* The two floating controls, Design above Colour, hidden while the prompts / guide are up.
              Design is offered on a published site too: it only edits the draft (like Colour), and the
              change goes live on the next Publish. */}
          {overlay == null && (
            <View style={styles.floaters} pointerEvents="box-none">
              <DesignSwitcher current={data.template} onSelect={handleDesign} busy={switching} disabled={uploading} />
              <ColourButton current={data.colorTheme} onPick={(hex) => commit((d) => setColour(d, hex))} disabled={uploading} />
            </View>
          )}
          {uploading && (
            <View style={styles.uploading} pointerEvents="none">
              <ActivityIndicator color={colors.accent} />
              <Text style={styles.uploadingText}>{logoBusy ? 'Uploading logo…' : 'Uploading photo…'}</Text>
            </View>
          )}
        </View>

        {overlay == null && stockPhotoPaths(data).length > 0 && (
          <StockPhotoNudge onAddPhotos={() => setSheet('photos')} />
        )}
        <WebTips
          data={data}
          draftId={site.draftId}
          published={!!site.deployedUrl}
          hidden={overlay != null || sheet != null || uploading || Platform.OS !== 'web'}
          actions={{
            photos: () => setSheet('photos'),
            phone: () => openEdit('phone', false),
            services: () => { setServicesAdd(false); setServicesFocus(null); setSheet('services'); },
            hours: () => { setHoursFromPreview(false); setSheet('hours'); },
            team: () => setSheet('team'),
            pages: () => setSheet('pages'),
            publish: handlePublish,
          }}
        />
        <PublishBar
          onPages={() => setSheet('pages')}
          onSections={openSections}
          onText={() => setSheet('fields')}
          onPhotos={() => setSheet('photos')}
          onPublish={handlePublish}
          disabled={uploading || overlay != null}
          padBottom={tabBarHidden}
        />

        <AllFieldsSheet
          visible={sheet === 'fields'}
          data={data}
          onPick={(path) => closeThen(() => openTap(path, true))}
          onClose={() => setSheet(null)}
          onDismiss={onSheetDismiss}
        />
        <PhotosSheet
          visible={sheet === 'photos'}
          data={data}
          onPick={(path) => closeThen(() => pickPhoto(path))}
          onLogo={LOGO_ENABLED ? openLogo : undefined}
          onClose={() => setSheet(null)}
          onDismiss={onSheetDismiss}
        />
        <HeaderSheet
          visible={sheet === 'header'}
          data={data}
          previewUri={data.logo && logoPreview?.url === data.logo.url ? logoPreview.dataUri : null}
          contrast={data.logo && logoPreview?.url === data.logo.url ? logoPreview.contrast : null}
          uploading={logoBusy}
          error={logoError}
          onShow={(s) => commit((d) => withHeaderShow(d, s))}
          onSaveName={(t) => commit((d) => savePathValue(d, 'shopName', t))}
          onPickLogo={() => closeThen(() => void pickLogo())}
          onRemoveLogo={removeLogo}
          onClose={() => setSheet(null)}
          onDismiss={onSheetDismiss}
        />
        <PagesSheet
          visible={sheet === 'pages'}
          data={data}
          current={page}
          currentTitle={pageTitle}
          onEditPage={canEditPage ? () => closeThen(() => setSheet('pageSections')) : undefined}
          onSave={savePages}
          onEditPlace={editPlace}
          onClose={() => setSheet(null)}
          onDismiss={onSheetDismiss}
        />
        <PageSectionsSheet
          visible={sheet === 'pageSections'}
          data={data}
          page={page}
          title={pageTitle}
          onChange={commit}
          onEditText={(path) => closeThen(() => openEdit(path, false, true))}
          onChangeImage={(path) => closeThen(() => openHero(path))}
          onOpenSource={(key) => closeThen(() => setSheet(key))}
          onClose={() => setSheet(null)}
          onDismiss={onSheetDismiss}
        />
        <HeroPhotoSheet
          visible={sheet === 'hero'}
          data={data}
          path={heroPath}
          onPhone={() => closeThen(() => pickPhoto(heroPath))}
          onGallery={(url) => { commit((d) => setPhoto(d, heroPath, url)); setSheet(null); }}
          onSample={() => { commit((d) => clearHero(d, heroPath)); setSheet(null); }}
          onClose={() => setSheet(null)}
          onDismiss={onSheetDismiss}
        />
        <SectionsSheet
          visible={sheet === 'sections'}
          data={data}
          onOpen={openSection}
          onLogo={LOGO_ENABLED ? openLogo : undefined}
          previewUri={data.logo && logoPreview?.url === data.logo.url ? logoPreview.dataUri : null}
          onClose={() => setSheet(null)}
          onDismiss={onSheetDismiss}
        />
        {shop ? (
          <BookingsServicesSheet
            visible={sheet === 'services'}
            shop={shop}
            onServices={(list) => commitRecord((r) => ({ ...r, data: mirrorServices(r.data, list, r.inputs.samplePricesFilled) }))}
            onClose={() => (servicesAdd || servicesFocus != null ? closeThen(() => { setServicesAdd(false); setServicesFocus(null); }) : closeThen(() => setSheet('sections')))}
            onDismiss={onSheetDismiss}
            upload={uploadForSection}
            startAdd={servicesAdd}
            focus={servicesFocus != null ? { index: servicesFocus, title: shown.services?.[servicesFocus]?.title ?? '' } : null}
          />
        ) : (
          <ServicesSheet
            visible={sheet === 'services'}
            data={data}
            onChange={commit}
            onClose={() => (servicesAdd || servicesFocus != null ? closeThen(() => { setServicesAdd(false); setServicesFocus(null); }) : closeThen(() => setSheet('sections')))}
            onDismiss={onSheetDismiss}
            upload={uploadForSection}
            startAdd={servicesAdd}
            focusIndex={servicesFocus}
          />
        )}
        <HoursSheet
          visible={sheet === 'hours'}
          data={data}
          onChange={commit}
          onClose={() => (hoursFromPreview ? closeThen(() => setHoursFromPreview(false)) : closeThen(() => setSheet('sections')))}
          onDismiss={onSheetDismiss}
        />
        <TeamSheet
          visible={sheet === 'team'}
          data={data}
          onChange={commit}
          onClose={() => closeThen(() => setSheet('sections'))}
          onDismiss={onSheetDismiss}
          upload={uploadForSection}
          onOpenTeam={() => closeThen(() => router.push('/team'))}
        />
        <GallerySheet
          visible={sheet === 'gallery'}
          data={data}
          onChange={commit}
          onClose={() => closeThen(() => setSheet('sections'))}
          onDismiss={onSheetDismiss}
          upload={uploadForSection}
        />
        <ReviewsSheet
          visible={sheet === 'reviews'}
          data={data}
          onChange={commit}
          onClose={() => closeThen(() => setSheet('sections'))}
          onDismiss={onSheetDismiss}
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
        <ButtonSheet
          visible={sheet === 'button'}
          kind={button.kind}
          title={buttonDef?.title ?? 'Button'}
          text={textValue(data, buttonPath)}
          defaultText={buttonDef ? defaultLabel(button.labelKey as LabelKey, nicheOf(data), data) : ''}
          maxLength={buttonDef?.max}
          book={{ choice: prefs.choice, own: prefs.own, status: bookTargetStatus(linkCtx, prefs.own), teamHasOwnLink: !!data.staff?.some((m) => !!m.bookingUrl?.trim()), hasPlan: ents.known && ents.bookings }}
          callText={callKey ? textValue(data, `labels.${callKey}`) : ''}
          callDefault={callKey ? defaultLabel(callKey as LabelKey, nicheOf(data), data) : ''}
          phone={data.phone}
          address={data.contact?.address}
          onSave={(c) => saveButton(button.labelKey, c)}
          onClose={() => setSheet(null)}
          onDismiss={onSheetDismiss}
          onOpenSetup={() => closeThen(() => router.push('/bookings-setup'))}
          onSeePlans={() => closeThen(() => (bookingsPlanRoute(siteRef.current, ents) === 'publish' ? publishWith('bookings') : void upgrade.run()))}
        />
        <EditSheet
          visible={sheet === 'edit'}
          path={edit.path}
          label={fieldLabel(edit.path)}
          value={editValue}
          maxLength={textMaxLength(edit.path)}
          note={editedCopyKey && isCopyEdited(data, editedCopyKey) ? 'This text no longer updates with your prices.' : undefined}
          actions={editedCopyKey ? [
            { title: 'Reset to suggested', onPress: () => commit((d) => resetCopy(d, editedCopyKey)) },
            ...(copyPathHasWordings(edit.path) ? [{ title: 'Try other wording', onPress: () => commit((d) => tryOtherWording(d, editedCopyKey)) }] : []),
          ] : undefined}
          onSave={(v) => commit((d) => savePathValue(d, edit.path, v))}
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
        <TutorialLayer controller={tour} />
        <SiteReadyNotice visible={welcome} onClose={closeWelcome} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  body: { flex: 1 },
  preview: { flex: 1 },
  // Design above Theme, vertically centred on the preview's left edge (web: left-3, top-1/2).
  floaters: { ...StyleSheet.absoluteFillObject, left: 12, right: undefined, justifyContent: 'center', gap: 8 },
  uploading: {
    position: 'absolute', alignSelf: 'center', top: '45%',
    flexDirection: 'row', alignItems: 'center', gap: 10,
    paddingHorizontal: 18, paddingVertical: 12, borderRadius: 999,
    backgroundColor: 'rgba(0,0,0,0.8)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)',
  },
  uploadingText: { fontFamily: fonts.bodySemi, fontSize: 13, color: '#fff' },
});
