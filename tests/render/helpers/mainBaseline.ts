// The renderer exactly as origin/main 82ab412c had it (before extraPages.searchPages), rebuilt from git at test time into the git-ignored
// .cache-ios-baseline/ (same technique as helpers/iosBaseline.ts). searchPagesMark.test.ts renders the same sites with this and with the branch.
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const MAIN_BASELINE = '82ab412c';
const ROOT = join(__dirname, '../../..');
const DIR = join(ROOT, '.cache-ios-baseline', `main-${MAIN_BASELINE}`);

export function mainBaselineAvailable(): boolean {
  try { execFileSync('git', ['cat-file', '-e', `${MAIN_BASELINE}^{commit}`], { cwd: ROOT, stdio: 'ignore' }); return true; } catch { return false; }
}

let extracted = false;
export async function loadMainBaseline() {
  if (!extracted) {
    extracted = true;
    rmSync(DIR, { recursive: true, force: true });
    mkdirSync(DIR, { recursive: true });
    const tar = execFileSync('git', ['archive', MAIN_BASELINE, 'lib', 'types.ts'], { cwd: ROOT, maxBuffer: 256 * 1024 * 1024 });
    execFileSync('tar', ['-x', '-C', DIR], { input: tar });
  }
  const publish = await import(/* @vite-ignore */ join(DIR, 'lib/publishSite.ts'));
  const site = await import(/* @vite-ignore */ join(DIR, 'lib/render/site.ts'));
  const redirects = await import(/* @vite-ignore */ join(DIR, 'lib/siteRedirects.ts'));
  return { renderPendingBundle: publish.renderPendingBundle, renderSiteBundle: site.renderSiteBundle, redirectsApply: redirects.redirectsApply };
}
