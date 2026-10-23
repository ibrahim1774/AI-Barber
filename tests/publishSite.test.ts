import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, string>();
// Generations, as GCS keeps them: the stored copy is written compare-and-set (e2e I1).
const gens = new Map<string, number>();
let gen = 0;
const notFound = () => Object.assign(new Error('not found'), { code: 404 });

vi.mock('@google-cloud/storage', () => ({
  Storage: class {
    bucket() {
      return {
        file: (name: string, opts: { generation?: number } = {}) => ({
          exists: async () => [store.has(name)],
          getMetadata: async () => {
            if (!store.has(name)) throw notFound();
            return [{ generation: String(gens.get(name)) }];
          },
          download: async () => {
            if (opts.generation != null && String(opts.generation) !== String(gens.get(name))) throw notFound();
            return [Buffer.from(store.get(name) ?? '')];
          },
          save: async (data: string, o: any = {}) => {
            const want = o?.preconditionOpts?.ifGenerationMatch;
            if (want != null && String(gens.get(name) ?? 0) !== String(want)) throw Object.assign(new Error('precondition'), { code: 412 });
            store.set(name, data);
            gens.set(name, ++gen);
          },
        }),
      };
    }
  },
}));

const deployRenderedSite = vi.fn(async (_args: any) => ({ deploymentUrl: 'https://x.vercel.app', uploadedImages: {} }));
vi.mock('../lib/deploySite.js', () => ({ deployRenderedSite: (a: any) => deployRenderedSite(a) }));
// A web site: no shop behind the slug (lib/siteSubpages.ts; a lookup error would fail the publish).
vi.mock('../lib/siteSubpages.js', async (orig) => ({ ...(await orig<object>()), findShopForSite: async () => null }));

import { publishSite, writePendingSite, slugify } from '../lib/publishSite.js';

const pending: any = {
  siteId: 'fresh-cuts',
  siteData: {
    template: 'luxe',
    shopName: 'Fresh Cuts',
    area: 'Austin',
    phone: '555-0100',
    hero: { heading: 'Fresh Cuts', tagline: 'Sharp.', imageUrl: '' },
    about: { heading: 'About', description: ['Barbers.'], imageUrl: '' },
    services: [{ title: 'Fade', subtitle: 'Classic', description: 'A fade.', icon: 'scissors', imageUrl: '' }],
    contact: { address: '1 Main St', email: 'a@b.co' },
    gallery: [],
    craftImages: [],
    staff: [],
  },
  imageUrlMap: {},
};

const liveFetch = () => vi.fn(async () => new Response('<meta name="published-at" content="x">', { status: 200 }));

beforeEach(() => {
  store.clear();
  gens.clear();
  deployRenderedSite.mockClear();
  process.env.GCS_BUCKET_NAME = 'b';
  process.env.GCS_CREDENTIALS = JSON.stringify({ project_id: 'p' });
});

describe('publishSite', () => {
  it('default call returns alreadyLive without deploying when our marker is served', async () => {
    await writePendingSite('fresh-cuts', pending);
    vi.stubGlobal('fetch', liveFetch());
    const out = await publishSite('fresh-cuts');
    expect(out.ok).toBe(true);
    expect(out.alreadyLive).toBe(true);
    expect(deployRenderedSite).not.toHaveBeenCalled();
  });

  it('force deploys even when the site is already live', async () => {
    await writePendingSite('fresh-cuts', pending);
    vi.stubGlobal('fetch', liveFetch());
    const out = await publishSite('fresh-cuts', { force: true });
    expect(out.ok).toBe(true);
    expect(out.alreadyLive).toBe(false);
    expect(deployRenderedSite).toHaveBeenCalledTimes(1);
  });

  it('slugify is idempotent: a cut at 50 never leaves a trailing dash (review finding 1)', () => {
    const S = 'a'.repeat(45) + '-bcd';
    for (const raw of [S + '-zzz', S + '-', S + '--x', 'Fresh Cuts', "Joe's  Barber -- Shop!", '-x-', 'é'.repeat(80)]) {
      const once = slugify(raw);
      expect(slugify(once)).toBe(once);
      expect(once).not.toMatch(/^-|-$/);
      expect(once.length).toBeLessThanOrEqual(50);
    }
    expect(slugify(S + '-zzz')).toBe(S);
  });

  it('writePendingSite then publishSite reads it back', async () => {
    await writePendingSite('Fresh Cuts', pending);
    expect(slugify('Fresh Cuts')).toBe('fresh-cuts');
    const stored = JSON.parse(store.get('pending-sites/fresh-cuts.json')!);
    expect(stored.siteId).toBe('fresh-cuts');
    expect(typeof stored.savedAt).toBe('number');
    expect(stored.data.siteData.shopName).toBe('Fresh Cuts');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    const out = await publishSite('fresh-cuts');
    expect(out.ok).toBe(true);
    expect(out.alreadyLive).toBe(false);
    expect(deployRenderedSite).toHaveBeenCalledTimes(1);
    expect(deployRenderedSite.mock.calls[0][0].siteId).toBe('fresh-cuts');
  });
});

describe('publishSite stamping (stored copy can change during a deploy)', () => {
  const read = () => JSON.parse(store.get('pending-sites/fresh-cuts.json')!).data;

  it('stamps deployedUrl onto the copy it deployed', async () => {
    await writePendingSite('fresh-cuts', { ...pending, version: 3, timestamp: 10 });
    await publishSite('fresh-cuts', { force: true });
    expect(read()).toMatchObject({ version: 3, deployedUrl: 'https://x.vercel.app' });
  });

  it('a newer copy written during the deploy is not overwritten by the stale stamp', async () => {
    await writePendingSite('fresh-cuts', { ...pending, version: 3, timestamp: 10 });
    deployRenderedSite.mockImplementationOnce(async () => {
      await writePendingSite('fresh-cuts', { ...pending, siteData: { ...pending.siteData, phone: 'NEW' }, version: 4, timestamp: 20 });
      return { deploymentUrl: 'https://x.vercel.app', uploadedImages: {} };
    });
    await publishSite('fresh-cuts', { force: true });
    expect(read()).toMatchObject({ version: 4, timestamp: 20 });
    expect(read().siteData.phone).toBe('NEW');
  });

  it('I2: a newer copy written during the deploy is deployed too (the last deploy is the stored copy), and stamped', async () => {
    await writePendingSite('fresh-cuts', { ...pending, version: 3, timestamp: 10 });
    deployRenderedSite.mockImplementationOnce(async () => {
      await writePendingSite('fresh-cuts', { ...pending, siteData: { ...pending.siteData, shopName: 'Newer Name' }, version: 4, timestamp: 20 });
      return { deploymentUrl: 'https://x.vercel.app', uploadedImages: {} };
    });
    await publishSite('fresh-cuts', { force: true });
    expect(deployRenderedSite).toHaveBeenCalledTimes(2);
    expect(deployRenderedSite.mock.calls[1][0].html).toContain('Newer Name');
    expect(read()).toMatchObject({ version: 4, deployedUrl: 'https://x.vercel.app' });
  });

  it('I2: the redeploy loop is bounded when the copy changes on every deploy', async () => {
    const { MAX_REDEPLOYS } = await import('../lib/publishSite.js');
    await writePendingSite('fresh-cuts', { ...pending, version: 1, timestamp: 1 });
    let v = 1;
    deployRenderedSite.mockImplementation(async () => {
      v++;
      await writePendingSite('fresh-cuts', { ...pending, version: v, timestamp: v });
      return { deploymentUrl: 'https://x.vercel.app', uploadedImages: {} };
    });
    const out = await publishSite('fresh-cuts', { force: true });
    expect(out.ok).toBe(true);
    expect(deployRenderedSite).toHaveBeenCalledTimes(MAX_REDEPLOYS + 1);
    deployRenderedSite.mockReset();
    deployRenderedSite.mockImplementation(async () => ({ deploymentUrl: 'https://x.vercel.app', uploadedImages: {} }));
  });

  it('review fix 9: maxRedeploys caps the loop (request paths pass 1)', async () => {
    const { REQUEST_MAX_REDEPLOYS } = await import('../lib/publishSite.js');
    await writePendingSite('fresh-cuts', { ...pending, version: 1, timestamp: 1 });
    let v = 1;
    deployRenderedSite.mockImplementation(async () => {
      v++;
      await writePendingSite('fresh-cuts', { ...pending, version: v, timestamp: v });
      return { deploymentUrl: 'https://x.vercel.app', uploadedImages: {} };
    });
    expect((await publishSite('fresh-cuts', { force: true, maxRedeploys: REQUEST_MAX_REDEPLOYS })).ok).toBe(true);
    expect(deployRenderedSite).toHaveBeenCalledTimes(2);
    deployRenderedSite.mockReset();
    deployRenderedSite.mockImplementation(async () => ({ deploymentUrl: 'https://x.vercel.app', uploadedImages: {} }));
  });

  it('I2: with opts.transform, a redeploy of a newer copy gets the same transform', async () => {
    await writePendingSite('fresh-cuts', { ...pending, version: 3, timestamp: 10 });
    deployRenderedSite.mockImplementationOnce(async () => {
      await writePendingSite('fresh-cuts', { ...pending, siteData: { ...pending.siteData, shopName: 'Raw' }, version: 4, timestamp: 20 });
      return { deploymentUrl: 'https://x.vercel.app', uploadedImages: {} };
    });
    await publishSite('fresh-cuts', {
      force: true,
      transform: (p) => ({ ...p, siteData: { ...p.siteData, shopName: `${p.siteData.shopName} (transformed)` } }),
    });
    expect(deployRenderedSite.mock.calls[1][0].html).toContain('Raw (transformed)');
    expect(read().siteData.shopName).toBe('Raw');
  });

  it('opts.pending deploys that copy and leaves the stored content as it was', async () => {
    await writePendingSite('fresh-cuts', { ...pending, version: 3, timestamp: 10, siteData: { ...pending.siteData, shopUrl: 'https://s' } });
    const alt = { ...pending, version: 3, timestamp: 10, siteData: { ...pending.siteData, shopName: 'Rendered Copy' } };
    await publishSite('fresh-cuts', { force: true, pending: alt });
    expect(deployRenderedSite.mock.calls[0][0].html).toContain('Rendered Copy');
    expect(read().siteData.shopName).toBe('Fresh Cuts');
    expect(read().siteData.shopUrl).toBe('https://s');
    expect(read().deployedUrl).toBe('https://x.vercel.app');
  });
});

describe('renderPending', () => {
  it('renders a stored copy; throws on data the renderers cannot handle', async () => {
    const { renderPending } = await import('../lib/publishSite.js');
    expect(renderPending(pending)).toContain('Fresh Cuts');
    expect(() => renderPending({ ...pending, siteData: { ...pending.siteData, contact: undefined } })).toThrow();
  });
});

describe('casPending (compare-and-set on the stored copy, e2e I1)', () => {
  it('re-decides on the fresh copy when another write lands between the read and the write', async () => {
    const { casPending, readPendingVersioned, readPendingSite } = await import('../lib/publishSite.js');
    await writePendingSite('fresh-cuts', { ...pending, version: 1 });
    const io = {
      readPending: readPendingSite,
      readPendingVersioned,
      writePending: async (slug: string, p: any, o?: any) => {
        if (!raced) {
          raced = true;
          await writePendingSite('fresh-cuts', { ...pending, note: 'someone else', version: 2 }); // someone else
        }
        await writePendingSite(slug, p, o);
      },
    };
    let raced = false;
    const seen: number[] = [];
    const r = await casPending('fresh-cuts', io, (cur) => {
      seen.push(cur!.version!);
      return { write: { ...cur!, version: cur!.version! + 1 } };
    });
    expect(seen).toEqual([1, 2]);
    expect(r.written!.version).toBe(3);
    expect(JSON.parse(store.get('pending-sites/fresh-cuts.json')!).data).toMatchObject({ version: 3, note: 'someone else' });
  });

  it('a 412 whose fresh copy is exactly the write (a transport retry that had landed) counts as written', async () => {
    const { casPending, readPendingVersioned, readPendingSite } = await import('../lib/publishSite.js');
    await writePendingSite('fresh-cuts', { ...pending, version: 1 });
    const io = {
      readPending: readPendingSite, readPendingVersioned,
      writePending: async (slug: string, p: any, o?: any) => {
        await writePendingSite(slug, p); // landed...
        await writePendingSite(slug, p, o); // ...and the retry 412s
      },
    };
    let calls = 0;
    const r = await casPending('fresh-cuts', io, (cur) => { calls++; return { write: { ...cur!, version: 2 } }; });
    expect(calls).toBe(1);
    expect(r.written!.version).toBe(2);
  });

  it('a create (no object yet) is conditional too: generation 0', async () => {
    const { casPending, readPendingVersioned, readPendingSite } = await import('../lib/publishSite.js');
    let first = true;
    const io = {
      readPending: readPendingSite, readPendingVersioned,
      writePending: async (slug: string, p: any, o?: any) => {
        if (first) { first = false; await writePendingSite('fresh-cuts', { ...pending, version: 7 }); }
        await writePendingSite(slug, p, o);
      },
    };
    const r = await casPending('fresh-cuts', io, (cur) => ({ write: { ...pending, version: (cur?.version ?? 0) + 1 } }));
    expect(r.written!.version).toBe(8);
  });

  it('gives up after the attempts (nothing written by it) and never throws the 412', async () => {
    const { casPending, readPendingVersioned, readPendingSite } = await import('../lib/publishSite.js');
    await writePendingSite('fresh-cuts', { ...pending, version: 1 });
    let n = 1;
    const io = {
      readPending: readPendingSite, readPendingVersioned,
      writePending: async (slug: string, p: any, o?: any) => {
        await writePendingSite('fresh-cuts', { ...pending, version: ++n * 100 });
        await writePendingSite(slug, p, o);
      },
    };
    const r = await casPending('fresh-cuts', io, (cur) => ({ write: { ...cur!, version: cur!.version! + 1 } }), 3);
    expect(r.exhausted).toBe(true);
    expect(r.written).toBeUndefined();
  });
});

describe('pay-first move (re-review R1): the webhook / sweeper follow the details step\'s slug', () => {
  const held = { ...pending, siteData: { ...pending.siteData, shopName: 'Premium Cuts', awaitingDetails: true } };
  it('placeholder movedTo X and X movedFrom placeholder: publishes X (confirmed copy); the placeholder stays unpublished', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    deployRenderedSite.mockClear();
    await writePendingSite('premium-cuts-k3m9p2xq', { ...held, siteId: 'premium-cuts-k3m9p2xq', movedTo: 'jacks-cuts-x7k2' });
    await writePendingSite('jacks-cuts-x7k2', { ...pending, siteId: 'jacks-cuts-x7k2', movedFrom: 'premium-cuts-k3m9p2xq', siteData: { ...pending.siteData, shopName: 'Jacks Cuts', detailsConfirmed: true } });
    const out = await publishSite('premium-cuts-k3m9p2xq', { plan: 'monthly-custom15', projectExists: async () => false });
    expect(out).toMatchObject({ ok: true, siteId: 'jacks-cuts-x7k2' });
    expect(deployRenderedSite.mock.calls.map((c) => c[0].siteId)).toEqual(['jacks-cuts-x7k2']);
    expect(deployRenderedSite.mock.calls[0][0].html).toContain('Jacks Cuts');
  });

  it('a move that does not point back, or a non-pay-first plan, is not followed (the placeholder stays held)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    deployRenderedSite.mockClear();
    await writePendingSite('premium-cuts-k3m9p2xq', { ...held, siteId: 'premium-cuts-k3m9p2xq', movedTo: 'someone-else' });
    await writePendingSite('someone-else', { ...pending, siteId: 'someone-else' });
    expect(await publishSite('premium-cuts-k3m9p2xq', { plan: 'monthly-custom15' })).toMatchObject({ ok: false, reason: 'awaiting-details' });
    await writePendingSite('premium-cuts-k3m9p2xq', { ...held, siteId: 'premium-cuts-k3m9p2xq', movedTo: 'jacks-cuts-x7k2' });
    await writePendingSite('jacks-cuts-x7k2', { ...pending, siteId: 'jacks-cuts-x7k2', movedFrom: 'premium-cuts-k3m9p2xq' });
    const regular = await publishSite('premium-cuts-k3m9p2xq', { plan: 'monthly' });
    expect(regular.siteId).toBe('premium-cuts-k3m9p2xq');
    expect(deployRenderedSite.mock.calls.every((c) => c[0].siteId !== 'jacks-cuts-x7k2')).toBe(true);
  });
});

describe('S1: the pay-first move is followed only to a brand-new slug this purchase may take', () => {
  const held = { ...pending, siteData: { ...pending.siteData, shopName: 'Premium Cuts', awaitingDetails: true } };
  const PH = 'premium-cuts-k3m9p2xq';
  const TARGET = 'jacks-cuts-x7k2';
  const SID = 'cs_live_payfirst1aaaaaaaaaaaa';
  const setup = async (targetExtra: Record<string, unknown> = {}) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    deployRenderedSite.mockClear();
    await writePendingSite(PH, { ...held, siteId: PH, movedTo: TARGET });
    await writePendingSite(TARGET, { ...pending, siteId: TARGET, movedFrom: PH, siteData: { ...pending.siteData, shopName: 'Jacks Cuts', detailsConfirmed: true }, ...targetExtra });
  };
  const store = (rows: Record<string, any> = {}, bound: string[] = [PH]) => ({
    get: async (s: string) => rows[s] ?? null, insertIfAbsent: async () => true, claim: async () => false, upsert: async () => {},
    slugsForSession: async () => bound,
  });
  const run = (o: Record<string, unknown>) => publishSite(PH, { plan: 'monthly-custom15', sessionId: SID, projectExists: async () => false, ...o } as any);

  it('follows a brand-new target (no project, no owner row, only the placeholder bound)', async () => {
    await setup();
    expect(await run({ siteOwners: store() })).toMatchObject({ ok: true, siteId: TARGET });
  });
  it('a target that already has a Vercel project is not followed (placeholder held)', async () => {
    await setup();
    expect(await run({ projectExists: async () => true, siteOwners: store() })).toMatchObject({ ok: false, reason: 'awaiting-details' });
    expect(deployRenderedSite).not.toHaveBeenCalled();
  });
  it('a failed project lookup, or a stamped target, is not followed', async () => {
    await setup();
    expect(await run({ projectExists: async () => { throw new Error('x'); } })).toMatchObject({ ok: false, reason: 'awaiting-details' });
    await setup({ deployedUrl: 'https://jacks-cuts-x7k2.vercel.app' });
    expect(await run({})).toMatchObject({ ok: false, reason: 'awaiting-details' });
    expect(deployRenderedSite).not.toHaveBeenCalled();
  });
  it('an owned target (owner row from another session) is not followed', async () => {
    await setup();
    const owned = { [TARGET]: { slug: TARGET, user_id: 'u1', claim_email: null, source: 'admin', checkout_session_id: 'cs_other' } };
    expect(await run({ siteOwners: store(owned) })).toMatchObject({ ok: false, reason: 'awaiting-details' });
    expect(deployRenderedSite).not.toHaveBeenCalled();
  });
  it('a session that already bound another site, or whose owner lookup fails, is not followed', async () => {
    await setup();
    expect(await run({ siteOwners: store({}, [PH, 'another-site']) })).toMatchObject({ ok: false, reason: 'awaiting-details' });
    const broken = { ...store(), slugsForSession: async () => { throw new Error('site_owners table is missing'); } };
    expect(await run({ siteOwners: broken })).toMatchObject({ ok: false, reason: 'awaiting-details' });
    expect(deployRenderedSite).not.toHaveBeenCalled();
  });
});
