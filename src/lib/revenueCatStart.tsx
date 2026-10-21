import { useEffect } from 'react';
import { useSuperwallSettled } from '@/lib/paywall';
import { startRevenueCat } from '@/lib/revenuecat';

/**
 * Configures RevenueCat once Superwall has settled (configured, failed, or
 * 10 s): the same gate as LaunchPrompts. RevenueCat may show an App Store
 * message (a billing-issue sheet) as soon as it is configured, and
 * SuperwallKit's debug build traps on a system sheet during its configure.
 * Mounted once in _layout, under the Superwall provider.
 */
export function RevenueCatStart() {
  const settled = useSuperwallSettled();
  useEffect(() => {
    if (settled) startRevenueCat();
  }, [settled]);
  return null;
}
