// In-memory Google Cloud Storage for the e2e suite. Installed per test file with
//   vi.mock('@google-cloud/storage', async () => (await import('./harness/gcs.js')).storageModule);
// Every `new Storage()` shares one module-level object store (lib/publishSite.ts bucket() makes a
// new client on every call), with generations, the ifGenerationMatch precondition the admin
// history store relies on (412 when the object exists), custom metadata and prefix listing.
// Hooks let a test interleave a concurrent writer between a read and the write that follows it.

export interface GcsObject {
  data: Buffer;
  generation: number;
  metadata: Record<string, any>;
}

type Hook = (path: string) => void | Promise<void>;

export const gcs = {
  objects: new Map<string, GcsObject>(),
  generation: 0,
  log: [] as { op: 'exists' | 'download' | 'save' | 'delete' | 'list' | 'metadata'; path: string }[],
  /** Runs before a save lands (await it to hold the save). */
  beforeSave: null as Hook | null,
  /** Runs after a download resolved, before the caller continues. */
  afterDownload: null as Hook | null,
  /** Make the next save of a path throw this error. */
  failSave: new Map<string, Error>(),
  /**
   * The error shape a failed precondition has. 'api' is ApiError { code: 412 } (what the real
   * SDK throws for a non-resumable upload). 'gaxios' is what a RESUMABLE upload's session-start
   * 412 looks like with @google-cloud/storage 7.18 (code undefined, status / response.status 412):
   * a resumable save ignoring it would be a bug, and the code under test must still re-decide.
   */
  preconditionShape: 'api' as 'api' | 'gaxios',
  /** Every save's options (to assert resumable: false on conditional writes). */
  saveOpts: [] as { path: string; opts: any }[],
};

export function resetGcs() {
  gcs.objects.clear();
  gcs.generation = 0;
  gcs.log.length = 0;
  gcs.beforeSave = null;
  gcs.afterDownload = null;
  gcs.failSave.clear();
  gcs.preconditionShape = 'api';
  gcs.saveOpts.length = 0;
}

/** Parsed JSON at a path (null when absent). */
export function gcsJson(path: string): any {
  const o = gcs.objects.get(path);
  return o ? JSON.parse(o.data.toString('utf8')) : null;
}

/** The stored pending copy (`data` of pending-sites/{slug}.json). */
export function pendingOf(slug: string): any {
  return gcsJson(`pending-sites/${slug}.json`)?.data ?? null;
}

export function putJson(path: string, value: unknown) {
  gcs.objects.set(path, { data: Buffer.from(JSON.stringify(value)), generation: ++gcs.generation, metadata: {} });
}

class FakeFile {
  /** `bucket.file(name, { generation })` pins reads to that generation (real GCS: 404 once it is replaced, without object versioning). */
  constructor(readonly name: string, readonly opts: { generation?: number | string } = {}) {}

  get metadata() {
    return gcs.objects.get(this.name)?.metadata ?? {};
  }

  async exists(): Promise<[boolean]> {
    gcs.log.push({ op: 'exists', path: this.name });
    return [gcs.objects.has(this.name)];
  }

  /** Real GCS returns the generation as a string. */
  async getMetadata(): Promise<[Record<string, any>]> {
    gcs.log.push({ op: 'metadata', path: this.name });
    const o = gcs.objects.get(this.name);
    if (!o) throw Object.assign(new Error(`No such object: ${this.name}`), { code: 404 });
    return [{ ...o.metadata, name: this.name, generation: String(o.generation) }];
  }

  async download(): Promise<[Buffer]> {
    gcs.log.push({ op: 'download', path: this.name });
    const o = gcs.objects.get(this.name);
    if (!o) throw Object.assign(new Error(`No such object: ${this.name}`), { code: 404 });
    if (this.opts.generation != null && String(this.opts.generation) !== String(o.generation)) {
      throw Object.assign(new Error(`No such object: ${this.name}#${this.opts.generation}`), { code: 404 });
    }
    const copy = Buffer.from(o.data);
    if (gcs.afterDownload) await gcs.afterDownload(this.name);
    return [copy];
  }

  async save(data: string | Buffer, opts: any = {}): Promise<void> {
    gcs.saveOpts.push({ path: this.name, opts });
    if (gcs.beforeSave) await gcs.beforeSave(this.name);
    const fail = gcs.failSave.get(this.name);
    if (fail) {
      gcs.failSave.delete(this.name);
      throw fail;
    }
    const cur = gcs.objects.get(this.name);
    const want = opts?.preconditionOpts?.ifGenerationMatch;
    if (want != null && String(cur?.generation ?? 0) !== String(want)) {
      throw gcs.preconditionShape === 'gaxios'
        ? Object.assign(new Error('Request failed with status code 412'), { status: 412, response: { status: 412 } })
        : Object.assign(new Error('Precondition Failed'), { code: 412 });
    }
    gcs.log.push({ op: 'save', path: this.name });
    const meta = opts?.metadata ?? {};
    gcs.objects.set(this.name, {
      data: Buffer.isBuffer(data) ? Buffer.from(data) : Buffer.from(String(data), 'utf8'),
      generation: ++gcs.generation,
      metadata: { ...meta, contentType: opts?.contentType },
    });
  }

  async delete(opts: { ifGenerationMatch?: number | string } = {}): Promise<void> {
    const cur = gcs.objects.get(this.name);
    if (opts?.ifGenerationMatch != null && String(cur?.generation ?? 0) !== String(opts.ifGenerationMatch)) {
      throw Object.assign(new Error('Precondition Failed'), { code: 412 });
    }
    gcs.log.push({ op: 'delete', path: this.name });
    gcs.objects.delete(this.name);
  }
}

class FakeBucket {
  constructor(readonly name: string) {}
  file(name: string, opts?: { generation?: number | string }) {
    return new FakeFile(name, opts);
  }
  async getFiles(opts: { prefix?: string } = {}): Promise<[FakeFile[]]> {
    gcs.log.push({ op: 'list', path: opts.prefix ?? '' });
    const prefix = opts.prefix ?? '';
    return [[...gcs.objects.keys()].filter((k) => k.startsWith(prefix)).sort().map((k) => new FakeFile(k))];
  }
}

export class Storage {
  constructor(_opts?: unknown) {}
  bucket(name: string) {
    return new FakeBucket(name);
  }
}

export const storageModule = { Storage, default: { Storage } };
