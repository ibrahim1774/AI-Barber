import { describe, it, expect, vi, beforeEach } from 'vitest';

const objects = new Map<string, { data: string; metadata: any }>();
vi.mock('@google-cloud/storage', () => ({
  Storage: class {
    bucket() {
      return {
        file: (name: string) => ({
          exists: async () => [objects.has(name)],
          download: async () => [Buffer.from(objects.get(name)?.data ?? '')],
          save: async (data: string, opts: any = {}) => {
            if (opts.preconditionOpts?.ifGenerationMatch === 0 && objects.has(name)) {
              throw Object.assign(new Error('precondition failed'), { code: 412 });
            }
            objects.set(name, { data, metadata: opts.metadata || {} });
          },
        }),
        getFiles: async ({ prefix }: { prefix: string }) => [
          [...objects.entries()].filter(([n]) => n.startsWith(prefix)).map(([name, o]) => ({ name, metadata: o.metadata })),
        ],
      };
    }
  },
}));

import { gcsSiteStore } from '../../lib/admin/live.js';

const copy = (phone: string, over: any = {}): any => ({ siteId: 'fade-lab', siteData: { shopName: 'Fade Lab', phone }, version: 1, editedBy: 'owner', editedAt: 'T', ...over });

beforeEach(() => {
  objects.clear();
  process.env.GCS_BUCKET_NAME = 'b';
  process.env.GCS_CREDENTIALS = JSON.stringify({ project_id: 'p' });
  vi.spyOn(Date, 'now').mockReturnValue(1_800_000_000_000);
});

describe('gcsSiteStore history (write-once, collision-safe)', () => {
  it('writes {version}.json once; the same content again reuses it', async () => {
    const s = gcsSiteStore();
    expect(await s.writeHistory('fade-lab', 1, copy('A'))).toBe('1');
    expect(await s.writeHistory('fade-lab', 1, copy('A'))).toBe('1');
    expect([...objects.keys()]).toEqual(['pending-sites-history/fade-lab/1.json']);
  });

  it('a repeated version with different content goes to {version}-{ms}.json; both list and read back', async () => {
    const s = gcsSiteStore();
    await s.writeHistory('fade-lab', 1, copy('A'));
    expect(await s.writeHistory('fade-lab', 1, copy('C'))).toBe('1-1800000000000');
    await s.writeHistory('fade-lab', 2, copy('B', { version: 2, editedBy: 'admin' }));
    expect(await s.listHistory('fade-lab')).toEqual([
      { id: '2', version: 2, editedBy: 'admin', editedAt: 'T' },
      { id: '1-1800000000000', version: 1, editedBy: 'owner', editedAt: 'T' },
      { id: '1', version: 1, editedBy: 'owner', editedAt: 'T' },
    ]);
    expect((await s.readHistory('fade-lab', '1'))!.siteData.phone).toBe('A');
    expect((await s.readHistory('fade-lab', '1-1800000000000'))!.siteData.phone).toBe('C');
    expect(await s.readHistory('fade-lab', '../../pending-sites/x')).toBeNull();
  });

  it('other storage errors propagate (the edit then fails with history-failed)', async () => {
    const s = gcsSiteStore();
    const err = Object.assign(new Error('forbidden'), { code: 403 });
    const spy = vi.spyOn(objects, 'has').mockImplementationOnce(() => { throw err; });
    await expect(s.writeHistory('fade-lab', 1, copy('A'))).rejects.toThrow('forbidden');
    spy.mockRestore();
  });
});
