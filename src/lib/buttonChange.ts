import type { SiteRecord } from '@/lib/siteStore';
import { setOwnLink, withChoice } from '@/lib/bookingChoice';
import { savePathValue } from '@/lib/editor';
import type { ButtonChange } from '@/components/ButtonSheet';
import { CALL_LABEL_KEYS } from '@/lib/ctaButtons';

/**
 * One button-sheet save as ONE record change (a single save and a single syncOwnLink pass in commitRecord):
 * the button's text, then whichever site-wide source its link reads. Never writes a link per button.
 */
export function applyButtonChange(rec: SiteRecord, labelKey: string, change: ButtonChange): SiteRecord {
  let next: SiteRecord = { ...rec, data: savePathValue(rec.data, `labels.${labelKey}`, change.text) };
  if (change.phone !== undefined) next = { ...next, data: savePathValue(next.data, 'phone', change.phone) };
  if (change.address !== undefined) next = { ...next, data: savePathValue(next.data, 'contact.address', change.address) };
  // The Call choice edits the Call button's text (the design's Call labels), not the Book button's.
  if (change.book?.choice === 'call' && change.callText !== undefined) {
    for (const k of CALL_LABEL_KEYS[next.data.template ?? 'luxe'] ?? []) next = { ...next, data: savePathValue(next.data, `labels.${k}`, change.callText) };
  }
  if (change.book) {
    const withLink = change.book.url === undefined ? next : setOwnLink(next, change.book.url);
    next = withChoice(withLink, change.book.choice);
  }
  return next;
}
