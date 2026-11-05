// The renderer exactly as origin/main 08186dc had it (before the Phase 1 service-page work), rebuilt from git at test time:
// `git archive 08186dc lib types.ts` into .cache-ios-baseline/ (git-ignored, inside the repo so node_modules resolves), then imported.
// iosUnchanged.test.ts renders the same iOS-shaped sites with this and with the branch and requires identical output.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const BASELINE_COMMIT = '08186dc';
const ROOT = join(__dirname, '../../..');
const DIR = join(ROOT, '.cache-ios-baseline', BASELINE_COMMIT);

/** True when the baseline commit is in this clone (a shallow CI clone may lack it; the test then uses the stored fixture). */
export function baselineAvailable(): boolean {
  try { execFileSync('git', ['cat-file', '-e', `${BASELINE_COMMIT}^{commit}`], { cwd: ROOT, stdio: 'ignore' }); return true; } catch { return false; }
}

let extracted = false;
/** Re-extracted once per process, so a locally edited cache is never trusted. */
export function extractBaseline(): string {
  if (extracted) return DIR;
  extracted = true;
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
  const tar = execFileSync('git', ['archive', BASELINE_COMMIT, 'lib', 'types.ts'], { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 });
  execFileSync('tar', ['-x', '-C', DIR], { input: tar });
  return DIR;
}

export async function loadBaseline() {
  const dir = extractBaseline();
  const site = await import(/* @vite-ignore */ join(dir, 'lib/render/site.ts'));
  const publish = await import(/* @vite-ignore */ join(dir, 'lib/publishSite.ts'));
  const pending = await import(/* @vite-ignore */ join(dir, 'lib/ios/pendingData.ts'));
  return { renderSiteBundle: site.renderSiteBundle, renderPendingBundle: publish.renderPendingBundle, toPendingSiteData: pending.toPendingSiteData, buildImageUrlMap: pending.buildImageUrlMap };
}
