// Stripe product-name families, moved out of api/admin-overview.ts (behaviour unchanged).
export type ProductFamily = 'aibarber' | 'primehub' | 'other-biz' | 'unknown';

export const familyOf = (product: string): ProductFamily => {
  if (/ariya|haelabs|faceforge|nurplix/i.test(product)) return 'other-biz';
  if (/aibarber|prime barber/i.test(product)) return 'aibarber';
  if (/primehub/i.test(product)) return 'primehub';
  return 'unknown';
};

export const isCustomDesignProduct = (product: string): boolean => /custom website design|website hosting \(custom\)/i.test(product);
