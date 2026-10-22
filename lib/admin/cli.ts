// Command-line front end for lib/admin/sites.ts (scripts/admin-sites.mjs runs it).
// Pure over injected deps and output so it is testable; prints site content and
// customer emails only, never env values.
import type { WebsiteData } from '../../types.js';
import {
  findSites, getSite, listAccountDomains, republish, republishAll, rollback, updateSite,
  type AdminSitesDeps, type UpdateResult,
} from './sites.js';

export const USAGE = `AI Barber app sites (admin). Changes live customer sites — read docs/RUNBOOK-app-sites.md.

  node scripts/admin-sites.mjs find [text]                      search shop name, slug, email, URL, transaction id
  node scripts/admin-sites.mjs show <slug> [--json]             stored site, version, history
  node scripts/admin-sites.mjs set <slug> <path>=<text>... [--note "why"] [--expect <version>]
        path is dotted: phone, contact.address, services.0.price, hours.6.closed
        <path>:=<json> sets a JSON value: hours.6.closed:=true  services:='[...]'  bookingUrl:=null (removes)
  node scripts/admin-sites.mjs replace <slug> <file.json> [--note "why"] [--expect <version>]
        file is the whole siteData (start from: show <slug> --json > site.json)
  node scripts/admin-sites.mjs republish <slug>
  node scripts/admin-sites.mjs republish-all                    dry run: list what would be republished (default)
  node scripts/admin-sites.mjs republish-all --yes [--run <id>] [--limit <n>]   really republish every app site (resume with --run)
  node scripts/admin-sites.mjs rollback <slug> <version> [--expect <version>]   bring back a history version (4 or 4-1729…) as a new version
  node scripts/admin-sites.mjs vercel-domains [--json]         READ-ONLY: every domain in our Vercel account (auto-renew, expiry, tracked?)

Options: --env <file> (default .env.local, then .env)`;

export interface CliIo {
  out(line: string): void;
  err(line: string): void;
  readFile(path: string): string;
  newRunId(): string;
}

function flags(args: string[]) {
  const pos: string[] = [];
  const opt: Record<string, string | true> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (['note', 'expect', 'run', 'limit', 'env'].includes(key) && next !== undefined && !next.startsWith('--')) {
        opt[key] = next;
        i++;
      } else opt[key] = true;
    } else pos.push(a);
  }
  return { pos, opt };
}

/** `a.b=text` → string; `a.b:=json` → parsed JSON (null removes the key). */
export function parseAssignment(arg: string): [string, unknown] {
  const json = arg.indexOf(':=');
  const eq = arg.indexOf('=');
  if (json > 0 && json < eq) {
    const raw = arg.slice(json + 2);
    try {
      const v = JSON.parse(raw);
      return [arg.slice(0, json), v === null ? undefined : v];
    } catch {
      throw new Error(`"${arg}": the value after := must be JSON`);
    }
  }
  if (eq <= 0) throw new Error(`"${arg}": use path=value or path:=json`);
  return [arg.slice(0, eq), arg.slice(eq + 1)];
}

const pad = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s.padEnd(n));

function printUpdate(io: CliIo, r: UpdateResult) {
  if (r.ok) {
    io.out(`OK ${r.slug}: v${r.fromVersion} → v${r.version}` +
      (r.deployed ? `, live at ${r.deployedUrl}` : r.skipped ? ` (site is offline — ${r.offline}: saved, not deployed; goes live when restored/renewed)` : ''));
  } else {
    io.err(`FAILED ${r.slug}: ${r.error}${r.detail ? ` — ${r.detail}` : ''}` +
      (r.saved ? ` (v${r.version} is saved; run: republish ${r.slug})` : ''));
  }
  if (r.strippedLinks?.length) io.out(`Note: removed ${r.strippedLinks.join(', ')} (not covered by this customer's plan)`);
}

export async function runCli(argv: string[], deps: () => AdminSitesDeps, io: CliIo): Promise<number> {
  const [cmd, ...rest] = argv;
  const { pos, opt } = flags(rest);
  const by = 'cli';
  const note = typeof opt.note === 'string' ? opt.note : undefined;
  const expectedVersion = typeof opt.expect === 'string' ? Number(opt.expect) : undefined;
  if (expectedVersion !== undefined && !Number.isInteger(expectedVersion)) {
    io.err('--expect must be a version number');
    return 2;
  }
  const usage = () => {
    io.err(USAGE);
    return 2;
  };

  switch (cmd) {
    case 'find': {
      const rows = await findSites(pos.join(' '), deps());
      if (!rows.length) {
        io.out('No app sites match.');
        return 0;
      }
      io.out(`${pad('SLUG', 28)} ${pad('SHOP', 26)} ${pad('EMAIL', 30)} ${pad('STATUS', 11)} ${pad('TIER', 9)} ${pad('VER', 9)} URL`);
      for (const s of rows) {
        io.out(`${pad(s.slug, 28)} ${pad(s.shopName || '—', 26)} ${pad(s.email || '—', 30)} ${pad(s.status, 11)} ` +
          `${pad(s.tier || '?', 9)} ${pad(`v${s.version}${s.editedBy === 'admin' ? ' adm' : ''}`, 9)} ${s.deployedUrl || '—'}`);
      }
      io.out(`${rows.length} site(s).`);
      return 0;
    }

    case 'show': {
      if (!pos[0]) return usage();
      const r = await getSite(pos[0], deps());
      if (!r.ok) {
        io.err(`Not found: ${pos[0]}`);
        return 1;
      }
      const s = r.site!;
      if (opt.json) {
        io.out(JSON.stringify(s.siteData, null, 2));
        return 0;
      }
      io.out(`${s.shopName || '—'}  (${s.slug})`);
      io.out(`URL:      ${s.deployedUrl || '—'}`);
      io.out(`Customer: ${s.email || '—'}  transaction ${s.transactionId} (${s.environment})`);
      io.out(`Plan:     ${s.tier || '?'} (${s.productId})  status ${s.status}`);
      io.out(`Version:  v${s.version}${s.editedBy ? ` by ${s.editedBy}` : ''}${s.editedAt ? ` at ${s.editedAt}` : ''}${s.note ? `  note: ${s.note}` : ''}`);
      io.out(`History:  ${s.history.length ? s.history.map((h) => `v${h.id}${h.editedBy ? ` (${h.editedBy})` : ''}`).join(', ') : 'none'}`);
      io.out('');
      io.out(JSON.stringify(s.siteData, null, 2));
      return 0;
    }

    case 'set': {
      const [slug, ...assigns] = pos;
      if (!slug || !assigns.length) return usage();
      const set: Record<string, unknown> = {};
      try {
        for (const a of assigns) {
          const [path, value] = parseAssignment(a);
          set[path] = value;
        }
      } catch (e) {
        io.err((e as Error).message);
        return 2;
      }
      const r = await updateSite(slug, { set, note, expectedVersion, by }, deps());
      printUpdate(io, r);
      return r.ok ? 0 : 1;
    }

    case 'replace': {
      const [slug, file] = pos;
      if (!slug || !file) return usage();
      let siteData: WebsiteData;
      try {
        siteData = JSON.parse(io.readFile(file));
      } catch (e) {
        io.err(`Could not read ${file} as JSON: ${(e as Error).message}`);
        return 2;
      }
      const r = await updateSite(slug, { replace: siteData, note, expectedVersion, by }, deps());
      printUpdate(io, r);
      return r.ok ? 0 : 1;
    }

    case 'republish': {
      if (!pos[0]) return usage();
      const r = await republish(pos[0], deps(), by);
      if (r.ok) io.out(`OK ${r.slug}: live at ${r.deployedUrl}`);
      else io.err(`FAILED ${r.slug}: ${r.error}${r.detail ? ` — ${r.detail}` : ''}`);
      return r.ok ? 0 : 1;
    }

    case 'republish-all': {
      const d = deps();
      let limit = 6;
      if (opt.limit !== undefined) {
        limit = typeof opt.limit === 'string' && /^\d+$/.test(opt.limit) ? Number(opt.limit) : NaN;
        if (!(limit >= 1)) {
          io.err('--limit must be a positive whole number');
          return 2;
        }
      }
      // A real run redeploys every live app site: it needs --yes. Anything else is a dry run.
      if (!opt.yes) {
        const r = await republishAll({ dryRun: true }, d);
        io.out(`DRY RUN — would republish ${r.eligible!.length} site(s) (add --yes to do it):`);
        for (const s of r.eligible!) io.out(`  ${s}`);
        for (const w of r.wouldStrip || []) io.out(`  note: ${w.slug} deploys without ${w.links.join(', ')} (not in its plan)`);
        if (r.skipped.length) io.out(`Skipped ${r.skipped.length}: ${r.skipped.map((s) => `${s.slug} (${s.reason})`).join(', ')}`);
        return 0;
      }
      const runId = typeof opt.run === 'string' ? opt.run : io.newRunId();
      io.out(`Run ${runId} (if it stops, resume with: republish-all --yes --run ${runId})`);
      for (;;) {
        const r = await republishAll({ dryRun: false, runId, limit, by }, d);
        for (const x of r.results) {
          if (x.ok) io.out(`  OK     ${x.slug}  ${x.deployedUrl || ''}`);
          else io.err(`  FAILED ${x.slug}: ${x.error}${x.detail ? ` — ${x.detail}` : ''}`);
        }
        if (r.done) {
          io.out(`Done: ${r.totals.ok} republished, ${r.totals.failed} failed, ${r.skipped.length} skipped.`);
          return r.totals.failed ? 1 : 0;
        }
        if (!r.results.length) {
          io.err(`Stopped: no progress on this call; ${r.remaining} site(s) not reached (${(r.notReached || []).slice(0, 10).join(', ')}${r.remaining > 10 ? ', …' : ''}).`);
          io.err(`Resume with: node scripts/admin-sites.mjs republish-all --yes --run ${runId}`);
          return 1;
        }
        io.out(`  … ${r.remaining} to go`);
      }
    }

    case 'vercel-domains': {
      const r = await listAccountDomains(deps());
      if (!r.ok) {
        io.err(`FAILED: ${r.error}`);
        return 1;
      }
      if (opt.json) {
        io.out(JSON.stringify(r.domains, null, 2));
        return 0;
      }
      io.out(`${pad('DOMAIN', 34)} ${pad('BOUGHT', 11)} ${pad('EXPIRES', 11)} ${pad('AUTO-RENEW', 10)} TRACKED`);
      for (const d of r.domains!) {
        io.out(`${pad(d.name, 34)} ${pad(d.boughtAt?.slice(0, 10) || '(not via Vercel)', 11)} ${pad(d.expiresAt?.slice(0, 10) || '—', 11)} ` +
          `${pad(d.autoRenew ? 'ON' : 'off', 10)} ${d.tracked ? `${d.tracked.source} ${d.tracked.state} (${d.tracked.site})` : 'untracked'}`);
      }
      io.out(`${r.domains!.length} domain(s). Read-only: nothing was changed.`);
      return 0;
    }

    case 'rollback': {
      const [slug, v] = pos;
      if (!slug || v === undefined || !/^\d+(-\d+)?$/.test(v)) return usage();
      const r = await rollback(slug, v, deps(), { by, expectedVersion });
      printUpdate(io, r);
      return r.ok ? 0 : 1;
    }

    default:
      return usage();
  }
}
