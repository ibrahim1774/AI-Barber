/** Jest stand-in for @/lib/analytics: no network, no native SDKs. Same exports as the real module. */
export const posthog = null;
export const POSTHOG_AUTOCAPTURE = { captureScreens: false, captureTouches: true, propsToCapture: ['testID', 'accessibilityLabel', 'ph-label'] };
export async function initAttribution() {}
export async function requestTrackingThenStart() {}
export function requestTrackingWhenActive() {}
export function onTrackingSettled(_fn: () => void) {}
export function track(_event: string, _props?: Record<string, unknown>) {}
export function trackConversion(_kind?: string, _productId?: string, _price?: number, _currency?: string) {}
export function trackRegistration(_m?: string) {}
export function identifyUser(_userId: string) {}
export function resetUser() {}
export function screen(_name?: string, _props?: Record<string, unknown>) {}
export async function appsFlyerUID(): Promise<string | null> { return null; }
export function pendingAttributionEvents() { return 0; }
