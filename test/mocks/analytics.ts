/** Jest stand-in for @/lib/analytics: no network, no native SDKs. */
export const posthog = null;
export async function initAttribution() {}
export async function requestTrackingThenStart() {}
export function track(_event: string, _props?: Record<string, unknown>) {}
export function trackConversion() {}
export function screen() {}

export function identify(_props?: Record<string, unknown>) {}
export function trackRegistration(_m?: string) {}
export function pendingAttributionEvents() { return 0; }
