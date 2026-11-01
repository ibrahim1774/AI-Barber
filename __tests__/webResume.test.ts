import { RESUME_KEY, RESUME_MAX_AGE_MS, clearResume, paidParam, readResume, setResume, takeResume } from '@/lib/webResume';
import { flushWebAutosave } from '@/lib/webAutosave.web';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }; };
let session: ReturnType<typeof mem>; let local: ReturnType<typeof mem>;
beforeEach(() => { session = mem(); local = mem(); (globalThis as any).sessionStorage = session; (globalThis as any).localStorage = local; });
afterEach(() => { delete (globalThis as any).sessionStorage; delete (globalThis as any).localStorage; });

describe('resume-publish flag', () => {
  it('is written to sessionStorage and localStorage and read back with its plan hint', () => {
    setResume('bookings', 1000);
    expect(session.m.has(RESUME_KEY) && local.m.has(RESUME_KEY)).toBe(true);
    expect(readResume(2000)).toEqual({ planHint: 'bookings' });
  });
  it('without a hint it still resumes', () => { setResume(undefined, 1000); expect(readResume(1500)).toEqual({}); });
  it('takeResume is one-shot', () => {
    setResume('store', 1000);
    expect(takeResume(1500)).toEqual({ planHint: 'store' });
    expect(takeResume(1600)).toBeNull();
    expect(session.m.size + local.m.size).toBe(0);
  });
  it('is ignored (and removed) after 2 hours', () => {
    setResume('website', 1000);
    expect(readResume(1000 + RESUME_MAX_AGE_MS + 1)).toBeNull();
    expect(local.m.has(RESUME_KEY)).toBe(false);
  });
  it('survives blocked sessionStorage and garbage values', () => {
    (globalThis as any).sessionStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
    setResume('website', 1000);
    expect(readResume(1500)).toEqual({ planHint: 'website' });
    local.setItem(RESUME_KEY, '{not json');
    expect(readResume(1500)).toBeNull();
  });
  it('clearResume removes it from both', () => { setResume('store', 1); clearResume(); expect(readResume(2)).toBeNull(); });
});

describe('Stripe return parameter', () => {
  it.each([
    ['?paid=1', 'paid'], ['?x=1&paid=1', 'paid'], ['?paid=0', 'cancelled'], ['?paid=0&y=2', 'cancelled'], ['', null], ['?paid=2', null], ['?unpaid=1', null],
  ])('%s -> %s', (q, want) => expect(paidParam(q as string)).toBe(want));
});

describe('flushWebAutosave', () => {
  it('resolves even when nothing can be pushed, within the cap', async () => {
    const t = Date.now();
    await flushWebAutosave(200);
    expect(Date.now() - t).toBeLessThan(1000);
  });
});
