import { useCallback, useRef, useState } from 'react';
import { Alert } from 'react-native';
import { pickAndUploadPhoto } from '@/lib/photos';

/**
 * Picks and uploads one photo from inside a sheet. iOS can't present the photo
 * library while a Modal is up, so the sheet hides (`hidden`), the picker opens
 * from the Modal's onDismiss, and the sheet comes back afterwards. A failed
 * upload leaves everything as it was and shows an alert.
 *
 *   <Sheet visible={visible && !pick.hidden} onDismiss={() => pick.onDismiss(onDismiss)} />
 */
export function usePhotoPick(folder: string, onUrl: (url: string, target: number) => void) {
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const pending = useRef<number | null>(null);
  const cb = useRef(onUrl);
  cb.current = onUrl;

  const start = useCallback((target = 0) => {
    if (pending.current !== null || busy) return;
    pending.current = target;
    setHidden(true);
  }, [busy]);

  const onDismiss = useCallback((parent?: () => void) => {
    const target = pending.current;
    if (target === null) { parent?.(); return; }
    pending.current = null;
    setBusy(true);
    pickAndUploadPhoto(folder)
      .then((url) => { if (url) cb.current(url, target); })
      .catch((e) => {
        console.warn('[sections] photo upload failed:', e);
        Alert.alert("Couldn't upload that photo. Check your connection and try again.");
      })
      .finally(() => { setBusy(false); setHidden(false); });
  }, [folder]);

  return { hidden, busy, start, onDismiss };
}
