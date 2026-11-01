import { RESUME_KEY, RESUME_MAX_AGE_MS, clearResume, paidParam, readResume, setResume, takeResume } from '@/lib/webResume';
import { flushWebAutosave } from '@/lib/webAutosave.web';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }; };
let session: ReturnType<typeof mem>; let local: ReturnType<typeof mem>;
beforeEach(() => { session = mem(); local = mem(); (globalThis as any).sessionStorage = session; (globalThis as any).localStorage = local; });
afterEach(() => { delete (globalThis as any).sessionStorage; delete (globalThis as any).localStorage; });

describe('resume-publish flag', () => {
  it('is written to sessionStorage and localStorage and read back with its plan hint', () => {
    setResume('bookings', 'u1', 1000);
    expect(local.m.has(RESUME_KEY)).toBe(true);
    expect(session.m.has(RESUME_KEY)).toBe(false); // localStorage only: shared by every tab
    expect(readResume('u1', 2000)).toEqual({ planHint: 'bookings' });
  });
  it('without a hint it still resumes', () => { setResume(undefined, 'u1', 1000); expect(readResume('u1', 1500)).toEqual({}); });
  it('takeResume is one-shot', () => {
    setResume('store', 'u1', 1000);
    expect(takeResume('u1', 1500)).toEqual({ planHint: 'store' });
    expect(takeResume('u1', 1600)).toBeNull();
    expect(session.m.size + local.m.size).toBe(0);
  });
  it('is ignored (and removed) after 2 hours', () => {
    setResume('website', 'u1', 1000);
    expect(readResume('u1', 1000 + RESUME_MAX_AGE_MS + 1)).toBeNull();
    expect(local.m.has(RESUME_KEY)).toBe(false);
  });
  it('survives blocked sessionStorage and garbage values', () => {
    (globalThis as any).sessionStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
    setResume('website', 'u1', 1000);
    expect(readResume('u1', 1500)).toEqual({ planHint: 'website' });
    local.setItem(RESUME_KEY, '{not json');
    expect(readResume('u1', 1500)).toBeNull();
  });
  it('clearResume removes it from both', () => { setResume('store', 'u1', 1); clearResume(); expect(readResume('u1', 2)).toBeNull(); });
});

describe('resume flag belongs to one account', () => {
  it("another account's sign-in ignores AND clears it", () => {
    setResume('store', 'u1', 1000);
    expect(takeResume('u2', 1500)).toBeNull();
    expect(session.m.size + local.m.size).toBe(0);
    expect(readResume('u1', 1600)).toBeNull(); // gone for the owner too: it was cleared
  });
  it('no signed-in account means no resume', () => {
    setResume('store', 'u1', 1000);
    expect(readResume(null, 1500)).toBeNull();
    expect(readResume('u1', 1500)).toBeNull();
  });
  it('the same account gets it exactly once', () => {
    setResume('bookings', 'u1', 1000);
    expect(takeResume('u1', 1500)).toEqual({ planHint: 'bookings' });
    expect(takeResume('u1', 1501)).toBeNull();
  });
  it('sign-out clears it (signOut and the SIGNED_OUT listener both call clearResume)', () => {
    setResume('store', 'u1', 1000);
    clearResume();
    expect(readResume('u1', 1500)).toBeNull();
    const fs = require('fs');
    expect(fs.readFileSync(require('path').join(__dirname, '../src/lib/auth.ts'), 'utf8')).toMatch(/clearResume\(\)/);
    expect(fs.readFileSync(require('path').join(__dirname, '../src/lib/webAutosave.web.ts'), 'utf8')).toMatch(/SIGNED_OUT[\s\S]*clearResume/);
  });
});

describe('one-shot across tabs (S2)', () => {
  it("a sessionStorage-only copy is ignored (scenario A: the tab that started checkout cannot publish a second time)", () => {
    session.setItem(RESUME_KEY, JSON.stringify({ planHint: 'website', at: 1000, uid: 'u1' }));
    expect(takeResume('u1', 1500)).toBeNull();
  });
  it('scenario B: whichever tab takes it first wins; the other finds nothing', () => {
    setResume('website', 'u1', 1000);        // tab A started the checkout (storage shared by A and C)
    expect(takeResume('u1', 1500)).toEqual({ planHint: 'website' }); // tab C's focus refresh takes it
    expect(takeResume('u1', 1600)).toBeNull();                        // tab A's own wait finds none
  });
});

describe('web-paywall and the return banner (S3, S4)', () => {
  const fs = require('fs'); const path = require('path');
  const read = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  it('only the publish placement writes the resume flag', () => {
    expect(read('src/app/web-paywall.tsx')).toMatch(/placement === 'publish'\) setResume/);
  });
  it('the paid-return note is cleared after its first handling', () => {
    expect(read('src/components/StripeReturn.web.tsx')).toMatch(/paidReturn = false; \/\/ handled/);
  });
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
