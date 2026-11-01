import { DraftConflict, DraftEngine, type DraftBase, type SavedDraft } from '../../src/lib/webDraftEngine';

const row = (data: any, revision = 1): SavedDraft => ({ id: 'draft', revision, site_data: data, updated_at: new Date(revision * 1000).toISOString() });
function fixture(data: any = { heading: 'Original', phone: '111' }) {
  let user: string | null = 'owner';
  let local = { id: 'draft', data: { ...data } };
  let remote: SavedDraft | null = row({ ...data });
  let base: DraftBase | null = { owner: 'owner', row: row({ ...data }) };
  const io = {
    owner: jest.fn(async () => user), local: jest.fn(async () => local), base: jest.fn(async () => base),
    remember: jest.fn(async (b: DraftBase) => { base = b; }), read: jest.fn(async () => remote),
    write: jest.fn(async (value: typeof local, revision: number) => {
      if ((remote?.revision ?? 0) !== revision) throw Object.assign(new Error('conflict'), { code: 'draft_changed' });
      return remote = row(value.data, revision + 1);
    }),
    apply: jest.fn(async (expected: typeof local, saved: SavedDraft) => { if (JSON.stringify(local) === JSON.stringify(expected)) local = { id: saved.id, data: saved.site_data }; }),
    keepConflict: jest.fn(async () => {}),
  };
  return { engine: new DraftEngine(io), io, edit: (v: any) => { local = { ...local, data: { ...local.data, ...v } }; },
    other: (v: any) => { remote = row({ ...remote?.site_data, ...v }, (remote?.revision ?? 0) + 1); },
    user: (v: string | null) => { user = v; }, noBase: () => { base = null; },
    local: () => local, remote: () => remote, base: () => base };
}
describe('acknowledged web drafts', () => {
  it('does no network work when checkout sees already saved content', async () => {
    const f = fixture(); expect((await f.engine.save()).revision).toBe(1);
    expect(f.io.read).not.toHaveBeenCalled(); expect(f.io.write).not.toHaveBeenCalled();
  });
  it('keeps the acknowledged baseline and local edits after a failed write', async () => {
    const f = fixture(); f.edit({ heading: 'Mine' }); f.io.write.mockRejectedValueOnce(new Error('offline'));
    await expect(f.engine.save()).rejects.toThrow('offline');
    expect(f.base()?.row.revision).toBe(1); expect(f.local().data.heading).toBe('Mine');
    await f.engine.save(); expect(f.remote()?.site_data.heading).toBe('Mine');
  });
  it('refreshes a cached receipt rejected after another device saved a newer revision', async () => {
    const f = fixture(); f.other({phone:'new device'});
    expect((await f.engine.save()).revision).toBe(1);
    f.engine.invalidate(); await f.engine.save();
    expect(f.local().data.phone).toBe('new device'); expect(f.io.read).toHaveBeenCalledTimes(1);
  });
  it('never writes after a failed read', async () => {
    const f = fixture(); f.edit({ phone: '222' }); f.io.read.mockRejectedValueOnce(new Error('outage'));
    await expect(f.engine.save()).rejects.toThrow('outage'); expect(f.io.write).not.toHaveBeenCalled();
  });
  it('preserves independent edits from two devices', async () => {
    const f = fixture(); f.edit({ heading: 'Mine' }); f.other({ phone: '222' });
    await f.engine.save(); expect(f.remote()?.site_data).toEqual({ heading: 'Mine', phone: '222' });
  });
  it('re-reads and merges the winning write after a CAS race', async () => {
    const f = fixture(); f.edit({ heading: 'Mine' });
    const original = f.io.write.getMockImplementation()!;
    f.io.write.mockImplementationOnce(async (...args) => { f.other({ phone: '333' }); return original(...args); });
    await f.engine.save(); expect(f.remote()?.site_data).toEqual({ heading: 'Mine', phone: '333' });
  });
  it('keeps both versions of a same-field conflict until the user chooses', async () => {
    const f = fixture(); f.edit({ heading: 'Mine' }); f.other({ heading: 'Theirs', phone: '222' });
    await expect(f.engine.save()).rejects.toBeInstanceOf(DraftConflict);
    expect(f.io.keepConflict).toHaveBeenCalled(); expect(f.io.write).not.toHaveBeenCalled();
    f.engine.resolve(f.remote()!.revision, 'local'); await f.engine.save();
    expect(f.remote()?.site_data).toEqual({ heading: 'Mine', phone: '222' });
  });
  it('can resolve a fresh browser conflict without inventing a baseline', async () => {
    const f = fixture(); f.noBase(); f.edit({ heading: 'Mine' });
    await expect(f.engine.save()).rejects.toBeInstanceOf(DraftConflict);
    f.engine.resolve(1, 'remote'); await f.engine.save(); expect(f.local().data.heading).toBe('Original');
  });
  it('saves an edit made while an earlier write is in flight', async () => {
    const f = fixture(); f.edit({ heading: 'First' });
    const original = f.io.write.getMockImplementation()!;
    f.io.write.mockImplementationOnce(async (...args) => { f.edit({ heading: 'Second' }); return original(...args); });
    await f.engine.save(); expect(f.remote()?.site_data.heading).toBe('Second'); expect(f.io.write).toHaveBeenCalledTimes(2);
  });
  it('stops before writing when the account changes during a read', async () => {
    const f = fixture(); f.edit({ heading: 'Mine' });
    f.io.read.mockImplementationOnce(async () => { f.user('other'); return f.remote(); });
    await expect(f.engine.save()).rejects.toThrow('account changed'); expect(f.io.write).not.toHaveBeenCalled();
  });
  it('never treats a different account draft as a merge target', async () => {
    const f = fixture(); f.edit({ heading: 'Mine' });
    f.io.read.mockResolvedValueOnce({ ...f.remote()!, id: 'other-draft' });
    await expect(f.engine.save()).rejects.toBeInstanceOf(DraftConflict); expect(f.io.write).not.toHaveBeenCalled();
  });
});
