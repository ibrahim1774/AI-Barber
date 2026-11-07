// Everything the manual-domain link handler and the sweep pass need, bound to the live services.
import { liveDomainDeps, notifySupportEmail, stripeCancelAndRefund, stripeSubscription } from '../ios/domainLive.js';
import { liveManualDeps } from './domainManualEnv.js';
import type { ManualEnv } from './domainManual.js';

export function liveManualEnv(): ManualEnv {
  return {
    flow: liveDomainDeps(),
    manual: liveManualDeps({ getSubscription: stripeSubscription }),
    cancelAndRefund: (id) => stripeCancelAndRefund(id),
    notifySupport: (subject, text) => notifySupportEmail(subject, text),
  };
}
