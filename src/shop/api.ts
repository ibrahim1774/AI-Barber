import type { CreateOrderResponse, ManualMethod, OrderBody, OrderResponse, Product, ShopResponse } from './types';

export class ApiError extends Error {
  constructor(public status: number, public code: string, public body: any = {}) {
    super(code);
  }
  get field(): string | undefined { return this.body?.field; }
  get serverMessage(): string | undefined { return typeof this.body?.message === 'string' ? this.body.message : undefined; }
  get products(): Product[] { return Array.isArray(this.body?.products) ? this.body.products : []; }
  get productIds(): string[] { return Array.isArray(this.body?.productIds) ? this.body.productIds : []; }
  get totalCents(): number | undefined { return Number.isFinite(this.body?.totalCents) ? this.body.totalCents : undefined; }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function createShopApi(fetchImpl: FetchLike = (i, init) => fetch(i, init)) {
  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(path, init);
    } catch {
      throw new ApiError(0, 'network');
    }
    let body: any = {};
    try { body = await res.json(); } catch { /* empty body */ }
    if (!res.ok) throw new ApiError(res.status, body?.error || 'error', body);
    return body as T;
  }
  const q = (o: Record<string, string>) => new URLSearchParams(o).toString();
  const post = (path: string, data: unknown) =>
    call<any>(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });

  return {
    shop: (slug: string) => call<ShopResponse>(`/api/store/shop?${q({ slug })}`),
    createOrder: (body: OrderBody) => post('/api/store/orders', body) as Promise<CreateOrderResponse>,
    order: (token: string) => call<OrderResponse>(`/api/store/order?${q({ token })}`),
    sent: (token: string, method: ManualMethod) => post('/api/store/sent', { token, method }) as Promise<object>,
  };
}
export type ShopApi = ReturnType<typeof createShopApi>;
