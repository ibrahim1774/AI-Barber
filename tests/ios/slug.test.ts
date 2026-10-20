import { describe, it, expect, vi, afterEach } from 'vitest';
import { chooseSlug, makeIsTaken, urlServes, vercelProjectExists } from '../../lib/ios/slug.js';

const never = async () => false;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('chooseSlug', () => {
  it('free base is used as is', async () => {
    expect(await chooseSlug('Fresh Cuts', 'Production', never)).toBe('fresh-cuts');
  });
  it('taken base gets a suffix', async () => {
    const isTaken = async (s: string) => s === 'fresh-cuts';
    expect(await chooseSlug('Fresh Cuts', 'Production', isTaken, () => 'ab12')).toBe('fresh-cuts-ab12');
  });
  it('sandbox prefix', async () => {
    expect(await chooseSlug('Fresh Cuts', 'Sandbox', never)).toBe('ios-test-fresh-cuts');
  });
  it('empty name', async () => {
    expect(await chooseSlug('!!!', 'Production', never)).toBe('barbershop');
  });
  it('gives up after five tries', async () => {
    const isTaken = vi.fn(async () => true);
    await expect(chooseSlug('Fresh Cuts', 'Production', isTaken, () => 'zzzz')).rejects.toThrow('slug-exhausted');
    expect(isTaken).toHaveBeenCalledTimes(6); // base + 5 suffixed
  });
  it('truncates long names and trims trailing dash', async () => {
    const name = 'a'.repeat(39) + ' b' + 'c'.repeat(20); // slug dash lands at index 39
    const s = await chooseSlug(name, 'Production', never);
    expect(s).toBe('a'.repeat(39));
    expect(s.endsWith('-')).toBe(false);
  });
  it('longest sandbox slug with suffix is exactly 50 chars (deployToVercel cuts at 50)', async () => {
    const s = await chooseSlug('x'.repeat(100), 'Sandbox', async (c) => !c.endsWith('-qqqq'), () => 'qqqq');
    expect(s.startsWith('ios-test-')).toBe(true);
    expect(s.length).toBe(50);
  });
  it('longest production slug with suffix stays within 50 chars', async () => {
    const s = await chooseSlug('x'.repeat(100), 'Production', async (c) => !c.endsWith('-qqqq'), () => 'qqqq');
    expect(s.length).toBeLessThanOrEqual(50);
  });
  it('default rand yields 4 lowercase base36 chars', async () => {
    const isTaken = async (s: string) => s === 'fresh-cuts';
    const s = await chooseSlug('Fresh Cuts', 'Production', isTaken);
    expect(s).toMatch(/^fresh-cuts-[a-z0-9]{4}$/);
  });
});

describe('makeIsTaken', () => {
  const deps = (o: Partial<Record<'p' | 'r' | 'v' | 'u', boolean>>) => ({
    pendingExists: async () => !!o.p,
    repoTaken: async () => !!o.r,
    projectExists: vi.fn(async () => !!o.v),
    urlServes: vi.fn(async () => !!o.u),
  });
  it('false when nothing has it', async () => {
    expect(await makeIsTaken(deps({}))('a')).toBe(false);
  });
  it('true when only pending exists', async () => {
    expect(await makeIsTaken(deps({ p: true }))('a')).toBe(true);
  });
  it('true when only repo has it', async () => {
    expect(await makeIsTaken(deps({ r: true }))('a')).toBe(true);
  });
  it('true when only a Vercel project with that name exists (no pending file, URL 404)', async () => {
    const d = deps({ v: true });
    expect(await makeIsTaken(d)('my-shop')).toBe(true);
    expect(d.projectExists).toHaveBeenCalledWith('my-shop');
    expect(d.urlServes).not.toHaveBeenCalled(); // authoritative check short-circuits the probe
  });
  it('a failing project check propagates (fail closed)', async () => {
    const d = { ...deps({}), projectExists: vi.fn(async () => { throw new Error('vercel-project-check-500'); }) };
    await expect(makeIsTaken(d)('my-shop')).rejects.toThrow('vercel-project-check-500');
  });
  it('existing Vercel project forces a suffix in chooseSlug', async () => {
    const isTaken = makeIsTaken({
      pendingExists: async () => false,
      repoTaken: async () => false,
      projectExists: async (s) => s === 'fresh-cuts',
      urlServes: async () => false,
    });
    expect(await chooseSlug('Fresh Cuts', 'Production', isTaken, () => 'ab12')).toBe('fresh-cuts-ab12');
  });
  it('true when only the URL serves', async () => {
    const d = deps({ u: true });
    expect(await makeIsTaken(d)('my-shop')).toBe(true);
    expect(d.urlServes).toHaveBeenCalledWith('https://my-shop.vercel.app');
  });
});

describe('urlServes', () => {
  it('true on 2xx', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200 }));
    vi.stubGlobal('fetch', f);
    expect(await urlServes('https://a.vercel.app')).toBe(true);
    expect((f.mock.calls[0] as any[])[1]).toMatchObject({ redirect: 'follow' });
  });
  it('false on 404', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 })));
    expect(await urlServes('https://a.vercel.app')).toBe(false);
  });
  it('false on network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('boom'); }));
    expect(await urlServes('https://a.vercel.app')).toBe(false);
  });
});

describe('vercelProjectExists', () => {
  const stub = (impl: (...a: any[]) => any) => { const f = vi.fn(impl); vi.stubGlobal('fetch', f); return f; };
  it('200 → true, using the deploy token against /v9/projects/{slug}', async () => {
    vi.stubEnv('VERCEL_TOKEN', 'tok');
    const f = stub(async () => ({ status: 200 }));
    expect(await vercelProjectExists('fresh-cuts')).toBe(true);
    const [url, init] = f.mock.calls[0] as any[];
    expect(url).toBe('https://api.vercel.com/v9/projects/fresh-cuts');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.signal).toBeDefined();
  });
  it('404 → false', async () => {
    vi.stubEnv('VERCEL_TOKEN', 'tok');
    stub(async () => ({ status: 404 }));
    expect(await vercelProjectExists('fresh-cuts')).toBe(false);
  });
  it.each([500, 401, 403, 429])('%i → throws', async (status) => {
    vi.stubEnv('VERCEL_TOKEN', 'tok');
    stub(async () => ({ status }));
    await expect(vercelProjectExists('fresh-cuts')).rejects.toThrow();
  });
  it('network error / timeout → throws', async () => {
    vi.stubEnv('VERCEL_TOKEN', 'tok');
    stub(async () => { throw new Error('aborted'); });
    await expect(vercelProjectExists('fresh-cuts')).rejects.toThrow();
  });
  it('missing VERCEL_TOKEN → throws without calling Vercel', async () => {
    vi.stubEnv('VERCEL_TOKEN', '');
    const f = stub(async () => ({ status: 404 }));
    await expect(vercelProjectExists('fresh-cuts')).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });
});
