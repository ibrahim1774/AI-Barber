// Web only: inline editor hints live in WebTips.web.tsx. The phone app shows nothing here.
import type { WebsiteData } from '@/web/types';

export type WebTipsProps = {
  data: WebsiteData;
  draftId: string;
  published: boolean;
  /** A sheet, prompt or upload is up: show nothing meanwhile. */
  hidden: boolean;
  actions: Record<'photos' | 'phone' | 'services' | 'hours' | 'team' | 'pages' | 'publish', () => void>;
};

export function WebTips(_props: WebTipsProps) {
  return null;
}
