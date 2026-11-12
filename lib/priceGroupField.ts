// Price test: the one named field the Meta / TikTok forwarders pass through, validated to a known group.
export function priceGroupField(body: unknown): 'base' | 'g10' | 'g20' | 'free' | null {
  const v = (body as any)?.price_group;
  return v === 'base' || v === 'g10' || v === 'g20' || v === 'free' ? v : null;
}
