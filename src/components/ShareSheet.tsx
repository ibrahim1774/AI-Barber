import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Pressable, Share, StyleSheet, Text, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { colors, fonts } from '@/constants/theme';
import { ChevronRightIcon } from '@/components/Icons';
import { QrScreen } from '@/components/QrScreen';
import { Sheet } from '@/components/EditSheet';
import { track } from '@/lib/analytics';
import { useEntitlements } from '@/lib/entitlements';
import { bookingUrl, loadMyShop } from '@/lib/shop';
import { loadStoreSettings, shopUrl } from '@/lib/store/data';
import { displayHost, shareLabel, shareMessage, type ShareLink } from '@/lib/share';

type Props = {
  visible: boolean;
  shopName: string;
  links: ShareLink[];
  source: 'live' | 'settings';
  onClose(): void;
};

/** One Share sheet for the live site: pre-written message rows, QR code, copy. */
export function ShareSheet({ visible, shopName, links: given, source, onClose }: Props) {
  // With bookings on, the Booking link row comes first (and the QR code points at it).
  const [bookingLink, setBookingLink] = useState<string | null>(null);
  // With the store open, a Shop link row goes last (the QR code keeps pointing at the first link).
  const [storeLink, setStoreLink] = useState<string | null>(null);
  // The Booking row needs the Bookings plan and the Shop row the Store plan (the server closes those pages without them).
  const ents = useEntitlements();
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    loadMyShop()
      .then(async (shop) => {
        if (!alive) return;
        setBookingLink(shop?.bookingsEnabled ? bookingUrl(shop) : null);
        const open = shop ? (await loadStoreSettings(shop.id)).storeEnabled : false;
        if (alive) setStoreLink(shop && open ? shopUrl(shop) : null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [visible]);
  const withBooking: ShareLink[] =
    bookingLink && ents.bookings && !given.some((l) => l.kind === 'booking') ? [{ kind: 'booking', url: bookingLink }, ...given] : given;
  const links: ShareLink[] =
    storeLink && ents.store && !withBooking.some((l) => l.kind === 'shop') ? [...withBooking, { kind: 'shop', url: storeLink }] : withBooking;
  // iOS can't present one Modal while another is still sliding away: the sheet
  // hides first and the QR opens from its onDismiss, and the reverse on Done.
  const [qrOpen, setQrOpen] = useState(false);
  const [sheetHidden, setSheetHidden] = useState(false);
  const next = useRef<'qr' | 'sheet' | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const first = links[0];

  useEffect(() => {
    if (visible) track('share_sheet_opened', { source });
  }, [visible, source]);

  useEffect(() => {
    if (!visible) {
      next.current = null;
      setQrOpen(false);
      setSheetHidden(false);
    }
  }, [visible]);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );

  const showQr = () => {
    track('qr_opened');
    next.current = 'qr';
    setSheetHidden(true);
  };
  const onSheetDismiss = () => {
    if (next.current !== 'qr') return;
    next.current = null;
    setQrOpen(true);
  };
  const closeQr = () => {
    next.current = 'sheet';
    setQrOpen(false);
  };
  const onQrDismiss = () => {
    if (next.current !== 'sheet') return;
    next.current = null;
    setSheetHidden(false);
  };

  const close = () => {
    setNote(null);
    onClose();
  };

  const flash = (text: string) => {
    setNote(text);
    AccessibilityInfo.announceForAccessibility(text);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setNote(null), 2000);
  };

  const shareLink = (link: ShareLink) => {
    track('share_link_tapped', { kind: link.kind });
    void Share.share({ message: shareMessage(link.kind, shopName, link.url) });
  };

  const copy = async (done: string) => {
    if (!first) return;
    await Clipboard.setStringAsync(first.url);
    track('share_copy_tapped');
    flash(done);
  };

  return (
    <>
      <Sheet visible={visible && !sheetHidden} title="Share your site" onClose={close} onDismiss={onSheetDismiss}>
        {links.map((link) => (
          <Pressable
            key={link.kind}
            onPress={() => shareLink(link)}
            accessibilityRole="button"
            accessibilityLabel={`Share ${shareLabel(link.kind)}`}
            style={({ pressed }) => [styles.link, pressed && { opacity: 0.7 }]}
          >
            <View style={styles.linkText}>
              <Text style={styles.linkTitle}>{shareLabel(link.kind)}</Text>
              <Text style={styles.linkHost} numberOfLines={1}>
                {displayHost(link.url)}
              </Text>
            </View>
            <ChevronRightIcon size={16} color={colors.faint} />
          </Pressable>
        ))}
        {!!first && (
          <>
            <Option title="Show QR code" onPress={showQr} />
            <Option title="Copy link" onPress={() => void copy('Copied')} />
            <Option
              title="Copy for your Instagram bio"
              onPress={() => void copy('Copied. Paste it into your Instagram bio.')}
            />
          </>
        )}
        <Text style={styles.note} accessibilityLiveRegion="polite">
          {note ?? ' '}
        </Text>
      </Sheet>
      {!!first && <QrScreen visible={visible && qrOpen} shopName={shopName} url={first.url} onClose={closeQr} onDismiss={onQrDismiss} />}
    </>
  );
}

function Option({ title, onPress }: { title: string; onPress(): void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.option, pressed && { opacity: 0.7 }]}
    >
      <Text style={styles.optionText}>{title}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: {
    minHeight: 64, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 12,
    borderRadius: 14, borderWidth: 1, borderColor: colors.accent, marginBottom: 12,
  },
  linkText: { flex: 1 },
  linkTitle: { fontFamily: fonts.bodyBold, fontSize: 17, color: colors.text },
  linkHost: { fontFamily: fonts.mono, fontSize: 12, color: colors.accent, marginTop: 3 },
  option: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 4, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hair },
  optionText: { fontFamily: fonts.bodySemi, fontSize: 15, color: colors.text },
  note: { fontFamily: fonts.bodySemi, fontSize: 13, color: '#22c55e', textAlign: 'center', marginTop: 12, minHeight: 18 },
});
