import { useRef, useCallback } from 'react';
import { SiteInstance, SaveStatus } from '../types';
import { dualWriteSave } from '../services/saveService';

const DEBOUNCE_MS = 600;
const SAVED_DISPLAY_MS = 1500;

export function useAutoSave(
  getSite: () => SiteInstance | null,
  userId: string | null,
  onStatusChange: (status: SaveStatus) => void
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerSave = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    timerRef.current = setTimeout(async () => {
      const site = getSite();
      if (!site) return;

      onStatusChange('saving');
      try {
        await dualWriteSave(site, userId);
        onStatusChange('saved');

        // Reset to idle after display period
        if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
        savedTimerRef.current = setTimeout(() => onStatusChange('idle'), SAVED_DISPLAY_MS);
      } catch (err) {
        console.error('[AutoSave] Error:', err);
        onStatusChange('error');
      }
    }, DEBOUNCE_MS);
  }, [userId, onStatusChange, getSite]);

  const saveNow = useCallback(async () => {
    if (timerRef.current) clearTimeout(timerRef.current);

    const site = getSite();
    if (!site) return;

    onStatusChange('saving');
    try {
      await dualWriteSave(site, userId);
      onStatusChange('saved');

      if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
      savedTimerRef.current = setTimeout(() => onStatusChange('idle'), SAVED_DISPLAY_MS);
    } catch (err) {
      console.error('[ManualSave] Error:', err);
      onStatusChange('error');
    }
  }, [userId, onStatusChange, getSite]);

  return { triggerSave, saveNow };
}
