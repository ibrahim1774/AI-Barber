import { merge3 } from './mergeSite';

export interface SavedDraft { id: string; revision: number; site_data: any; updated_at: string; deployed_url?: string | null; webBinding?: any }
export interface LocalDraft { id: string; data: any }
export interface DraftBase { owner: string; row: SavedDraft }
export class DraftConflict extends Error {
  constructor(public paths: string[], public remote: SavedDraft) { super('Another device changed this website. Your edits are kept on this device.'); }
}
export const stableDraft = (v: any): any => Array.isArray(v) ? v.map(stableDraft) : v && typeof v === 'object'
  ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stableDraft(v[k])])) : v;
export const sameDraft = (a: any, b: any) => JSON.stringify(stableDraft(a)) === JSON.stringify(stableDraft(b));
export function conflictPaths(base: any, local: any, remote: any, path = ''): string[] {
  if (sameDraft(local, base) || sameDraft(remote, base) || sameDraft(local, remote)) return [];
  if (local && remote && !Array.isArray(local) && !Array.isArray(remote) && typeof local === 'object' && typeof remote === 'object' && (base === undefined || base && typeof base === 'object' && !Array.isArray(base))) {
    return [...new Set([...Object.keys(local), ...Object.keys(remote)])].flatMap(k => conflictPaths(base?.[k], local[k], remote[k], path ? `${path}.${k}` : k));
  }
  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote) && base.length === local.length && base.length === remote.length)
    return local.flatMap((x, i) => conflictPaths(base[i], x, remote[i], `${path}.${i}`));
  return [path || 'website'];
}
export interface DraftIO {
  owner(): Promise<string | null>;
  local(): Promise<LocalDraft | null>;
  base(owner: string): Promise<DraftBase | null>;
  remember(base: DraftBase): Promise<void>;
  read(): Promise<SavedDraft | null>;
  write(local: LocalDraft, expectedRevision: number): Promise<SavedDraft>;
  apply(expected: LocalDraft, saved: SavedDraft): Promise<void>;
  keepConflict(owner: string, local: LocalDraft, remote: SavedDraft): Promise<void>;
}
/** Serialized per browser; server CAS prevents races between browsers. Failed writes never advance the base. */
export class DraftEngine {
  private refreshRequired = false;
  invalidate() { this.refreshRequired = true; }
  private tail: Promise<unknown> = Promise.resolve();
  private resolution: { revision: number; choice: 'local' | 'remote' } | null = null;
  constructor(private io: DraftIO) {}
  resolve(revision: number, choice: 'local' | 'remote') { this.resolution = { revision, choice }; }
  save(): Promise<SavedDraft> {
    const task = this.tail.catch(() => {}).then(() => this.run());
    this.tail = task;
    return task;
  }
  private async run(): Promise<SavedDraft> {
    const refresh = this.refreshRequired; this.refreshRequired = false;
    const owner = await this.io.owner();
    if (!owner) throw new Error('Sign in to save your website.');
    let base = await this.io.base(owner);
    for (let attempt = 0; attempt < 6; attempt++) {
      const local = await this.io.local();
      if (!local) throw new Error('Open your website before choosing a plan.');
      if (await this.io.owner() !== owner) throw new Error('Your account changed. Sign in again.');
      // Already acknowledged and unchanged: no network read or upload on the checkout critical path.
      if (!refresh && base?.owner === owner && base.row.id === local.id && sameDraft(base.row.site_data, local.data)) return base.row;
      const remote = await this.io.read(); // a failed read must never become an unconditional write
      if (await this.io.owner() !== owner) throw new Error('Your account changed. Sign in again.');
      if (!sameDraft(await this.io.local(), local)) continue; // an edit made during the read wins
      let candidate = local.data;
      if (remote) {
        if (remote.id !== local.id || !base || base.row.id !== local.id) {
          if (!sameDraft(local.data, remote.site_data)) {
            const resolution = this.resolution?.revision === remote.revision ? this.resolution : null;
            if (!resolution) {
              await this.io.keepConflict(owner, local, remote);
              throw new DraftConflict(['website'], remote);
            }
            candidate = resolution.choice === 'remote' ? remote.site_data : local.data;
          }
        } else {
          const paths = conflictPaths(base.row.site_data, local.data, remote.site_data);
          const resolution = this.resolution?.revision === remote.revision ? this.resolution : null;
          if (paths.length && !resolution) {
            await this.io.keepConflict(owner, local, remote);
            throw new DraftConflict(paths, remote);
          }
          candidate = resolution?.choice === 'remote'
            ? merge3(base.row.site_data, remote.site_data, local.data)
            : merge3(base.row.site_data, local.data, remote.site_data);
        }
      }
      try {
        const saved = await this.io.write({ id: remote?.id ?? local.id, data: candidate }, remote?.revision ?? 0);
        this.resolution = null;
        // Remember only an acknowledged server version. Preserve edits made while the request was in flight.
        if (await this.io.owner() !== owner) throw new Error('Your account changed. Sign in again.');
        base = { owner, row: saved };
        await this.io.remember(base);
        await this.io.apply(local, saved);
        if (sameDraft((await this.io.local())?.data, saved.site_data)) return saved;
      } catch (e: any) {
        if (e?.code !== 'draft_changed') throw e;
        // Same baseline, new read: fold in the winner's write rather than overwriting it.
      }
    }
    throw new Error('Changes are still arriving from another device. Your edits are kept; try again.');
  }
}
