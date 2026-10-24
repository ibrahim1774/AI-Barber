// @/constants/theme pulls expo-font -> expo-asset, which is not installed for jest. Component tests use this.
const proxy = (v: unknown) => new Proxy({}, { get: () => v });
export const colors = proxy('#000');
export const fonts = proxy('System');
export const swatchLabel = (hex: string) => `Use color ${hex}`;
