import type { CreateResponse, ManageResponse, ManualMethod, PayChoice, ShopResponse, Slot } from './types';

export class ApiError extends Error {
  constructor(public status: number, public code: string, public body: any = {}) {
    super(code);
  }
  get alternatives(): Slot[] { return Array.isArray(this.body?.alternatives) ? this.body.alternatives : []; }
  get field(): string | undefined { return this.body?.field; }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function createApi(fetchImpl: FetchLike = (i, init) => fetch(i, init)) {
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
    shop: (slug: string) => call<ShopResponse>(`/api/book/shop?${q({ slug })}`),
    days: (slug: string, serviceId: string, memberId: string, month: string) =>
      call<{ days: Record<string, boolean>; timezone: string }>(`/api/book/days?${q({ slug, serviceId, memberId, month })}`),
    slots: (slug: string, serviceId: string, memberId: string, date: string) =>
      call<{ slots: Slot[] }>(`/api/book/slots?${q({ slug, serviceId, memberId, date })}`),
    book: (b: {
      slug: string; serviceId: string; memberId: string; start: string;
      customer: { name: string; phone: string; email: string }; note?: string; pay: PayChoice;
    }) => post('/api/book/appointments', b) as Promise<CreateResponse>,
    manage: (token: string) => call<ManageResponse>(`/api/book/manage?${q({ token })}`),
    cancel: (token: string) => post('/api/book/manage', { token, action: 'cancel' }),
    reschedule: (token: string, start: string, memberId?: string) =>
      post('/api/book/manage', { token, action: 'reschedule', start, ...(memberId ? { memberId } : {}) }),
    sent: (token: string, method: ManualMethod) => post('/api/book/sent', { token, method }) as Promise<object>,
  };
}
export type Api = ReturnType<typeof createApi>;
