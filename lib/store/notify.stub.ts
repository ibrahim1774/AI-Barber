// STUB until S3b's lib/store/notify.ts lands (contract signature; throws 'not-built'). The flows
// call it through safeNotify, so a throw here never fails a request. Deleted at merge.
import type { StoreNotifyEvent } from './types.js';

export async function notifyOrder(_event: StoreNotifyEvent): Promise<void> {
  throw new Error('not-built');
}
