// Fake Vercel for the e2e suite: lib/deploySite.ts deployRenderedSite is replaced with
//   vi.mock('../../lib/deploySite.js', async () => (await import('./harness/vercel.js')).deploySiteModule);
// A deploy records { siteId, html } and, when it FINISHES, becomes what https://{siteId}.vercel.app
// serves (net.ts routes fetch there), so publishSite's alreadyLive check and the offline page
// behave for real. A test can hold deploys (gate) and pick the order they finish in.
import type { DeployRenderedSiteInput, DeployRenderedSiteResult } from '../../../lib/deploySite.js';

export interface DeployRecord {
  seq: number;
  siteId: string;
  html: string;
  imageUrls?: Record<string, string>;
  finished: boolean;
  failed?: string;
}

export const vercel = {
  seq: 0,
  deploys: [] as DeployRecord[],
  /** What each project serves now (the last deploy that finished). */
  live: new Map<string, string>(),
  /** Projects that exist without any deploy of ours (a stranger's project name). */
  projects: new Set<string>(),
  /** Await before a deploy finishes (hold it to reorder deploys). */
  gate: null as ((d: DeployRecord) => Promise<void> | void) | null,
  /** Return an Error to fail a deploy. */
  fail: null as ((d: DeployRecord) => Error | null | undefined) | null,
};

export function resetVercel() {
  vercel.seq = 0;
  vercel.deploys.length = 0;
  vercel.live.clear();
  vercel.projects.clear();
  vercel.gate = null;
  vercel.fail = null;
}

/** Deploys to one project, in start order. */
export const deploysOf = (siteId: string) => vercel.deploys.filter((d) => d.siteId === siteId);

/** The project name deployToVercel would use (lowercase, cut at 50). */
export const projectName = (siteId: string) => String(siteId).toLowerCase().slice(0, 50);

export async function deployRenderedSite(input: DeployRenderedSiteInput): Promise<DeployRenderedSiteResult> {
  if (!input.siteId) throw new Error('Missing required field: siteId');
  if (!input.html) throw new Error('Missing required field: html');
  const rec: DeployRecord = { seq: ++vercel.seq, siteId: input.siteId, html: input.html, imageUrls: input.imageUrls, finished: false };
  vercel.deploys.push(rec);
  if (vercel.gate) await vercel.gate(rec);
  const err = vercel.fail?.(rec);
  if (err) {
    rec.failed = err.message;
    throw err;
  }
  rec.finished = true;
  vercel.live.set(projectName(input.siteId), input.html);
  return { deploymentUrl: `https://${projectName(input.siteId)}.vercel.app`, uploadedImages: { ...(input.imageUrls || {}) } };
}

export const deploySiteModule = { deployRenderedSite };

/** A promise a test resolves by hand (to finish a held deploy). */
export function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}
