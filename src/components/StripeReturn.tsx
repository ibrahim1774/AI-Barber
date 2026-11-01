// Web only: the banner shown when Stripe sends the customer back to the editor lives in StripeReturn.web.tsx.
import type { PlanHint } from '@/lib/publishRequest';

export function StripeReturn(_props: { onResume(hint?: PlanHint): void }) {
  return null;
}
