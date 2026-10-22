import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseAssignment, runCli, type CliIo } from '../../lib/admin/cli.js';
import { fakes, purchase, site, stored } from './fakeDeps.js';

function io(files: Record<string, string> = {}) {
  const out: string[] = [];
  const err: string[] = [];
  const x: CliIo = {
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    readFile: (p) => { if (!(p in files)) throw new Error('ENOENT'); return files[p]; },
    newRunId: () => 'cli-run-1',
  };
  return { x, out, err, text: () => out.join('\n'), errText: () => err.join('\n') };
}

beforeEach(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('parseAssignment', () => {
  it('text by default, JSON with :=, null removes', () => {
    expect(parseAssignment('phone=5550100')).toEqual(['phone', '5550100']);
    expect(parseAssignment('about.heading=A = B')).toEqual(['about.heading', 'A = B']);
    expect(parseAssignment('hours.6.closed:=true')).toEqual(['hours.6.closed', true]);
    expect(parseAssignment('bookingUrl:=null')).toEqual(['bookingUrl', undefined]);
    expect(() => parseAssignment('phone')).toThrow();
    expect(() => parseAssignment('a:={bad')).toThrow(/JSON/);
  });
});

describe('runCli', () => {
  it('no command → usage, exit 2', async () => {
    const o = io();
    expect(await runCli([], () => fakes().deps, o.x)).toBe(2);
    expect(o.errText()).toMatch(/republish-all/);
  });

  it('find prints a row per site', async () => {
    const o = io();
    expect(await runCli(['find', 'fade'], () => fakes().deps, o.x)).toBe(0);
    expect(o.text()).toMatch(/fade-lab\s+Fade Lab\s+fade-lab@mail\.test\s+live/);
    expect(o.text()).toMatch(/1 site\(s\)/);
  });

  it('show --json prints only the siteData (for editing then replace)', async () => {
    const o = io();
    expect(await runCli(['show', 'fade-lab', '--json'], () => fakes().deps, o.x)).toBe(0);
    expect(JSON.parse(o.text()).shopName).toBe('Fade Lab');
  });

  it('set applies paths, with note and expected version', async () => {
    const f = fakes();
    const o = io();
    const code = await runCli(['set', 'fade-lab', 'phone=555 0199', 'services.0.price=$35', '--note', 'owner called', '--expect', '3'], () => f.deps, o.x);
    expect(code).toBe(0);
    expect(o.text()).toMatch(/OK fade-lab: v3 → v4, live at https:\/\/fade-lab\.vercel\.app/);
    const p = f.pending.get('fade-lab')!;
    expect(p.siteData.phone).toBe('555 0199');
    expect(p.siteData.services[0].price).toBe('$35');
    expect(p).toMatchObject({ note: 'owner called', editedBy: 'admin' });
    expect(f.events[0]).toMatchObject({ by: 'cli' });
  });

  it('set with a stale --expect fails with exit 1', async () => {
    const o = io();
    expect(await runCli(['set', 'fade-lab', 'phone=1', '--expect', '1'], () => fakes().deps, o.x)).toBe(1);
    expect(o.errText()).toMatch(/conflict/);
  });

  it('replace reads the file; bad JSON is exit 2', async () => {
    const f = fakes();
    const o = io({ 'site.json': JSON.stringify(site({ shopName: 'New Name' })), 'bad.json': '{' });
    expect(await runCli(['replace', 'fade-lab', 'site.json'], () => f.deps, o.x)).toBe(0);
    expect(f.pending.get('fade-lab')!.siteData.shopName).toBe('New Name');
    expect(await runCli(['replace', 'fade-lab', 'bad.json'], () => f.deps, o.x)).toBe(2);
  });

  it('republish, rollback', async () => {
    const f = fakes();
    const o = io();
    expect(await runCli(['republish', 'fade-lab'], () => f.deps, o.x)).toBe(0);
    await runCli(['set', 'fade-lab', 'phone=1'], () => f.deps, o.x);
    expect(await runCli(['rollback', 'fade-lab', '3'], () => f.deps, o.x)).toBe(0);
    expect(f.pending.get('fade-lab')!.siteData.phone).toBe('555-0100');
    expect(await runCli(['rollback', 'fade-lab', '99'], () => f.deps, o.x)).toBe(1);
  });

  it('republish-all --dry-run lists; a real run loops batches to the end', async () => {
    const f = fakes({
      rows: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((s) => purchase(s)),
      pending: Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((s) => [s, stored(s)])),
    });
    const o = io();
    expect(await runCli(['republish-all', '--dry-run'], () => f.deps, o.x)).toBe(0);
    expect(o.text()).toMatch(/Would republish 8 site/);
    expect(f.deps.publish).not.toHaveBeenCalled();
    const o2 = io();
    expect(await runCli(['republish-all', '--limit', '3'], () => f.deps, o2.x)).toBe(0);
    expect(o2.text()).toMatch(/Run cli-run-1/);
    expect(o2.text()).toMatch(/Done: 8 republished, 0 failed/);
    expect(f.deps.publish).toHaveBeenCalledTimes(8);
  });
});
