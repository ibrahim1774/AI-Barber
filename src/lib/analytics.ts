// No-op until Task 10 wires it to AppsFlyer and PostHog (same signature).
export function track(_event: string, _props?: Record<string, unknown>): void {}

// No-op until Task 10: the paywall's trial / subscribe conversion (Crew Lens's signature).
export function trackConversion(_kind: 'trial' | 'subscribe', _productId: string, _price: number, _currency: string): void {}
