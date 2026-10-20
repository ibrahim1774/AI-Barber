/** Jest stand-in for @/lib/analytics: no network, no native SDKs. Same exports as the real module. */
export const posthog = null;
export async function initAttribution() {}
export async function requestTrackingThenStart() {}
export function requestTrackingWhenActive() {}
export function track(_event: string, _props?: Record<string, unknown>) {}
export function trackConversion(_kind?: string, _productId?: string, _price?: number, _currency?: string) {}
export function trackRegistration(_m?: string) {}
export function identifyUser(_userId: string) {}
export function resetUser() {}
export function screen(_name?: string, _props?: Record<string, unknown>) {}
export async function appsFlyerUID(): Promise<string | null> { return null; }
export function pendingAttributionEvents() { return 0; }
