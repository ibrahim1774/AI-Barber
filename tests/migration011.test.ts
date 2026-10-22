import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { pickPublicBase } from '../lib/siteSubpages';

// Static checks on 011_site_subpages.sql: two server-only columns on ab_shops, nothing else.
const s = fs.readFileSync(path.join(__dirname, '../supabase/migrations/011_site_subpages.sql'), 'utf8');
const code = s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').replace(/\s+/g, ' ').trim();

describe('011_site_subpages.sql', () => {
  it('adds exactly site_base_url and site_look to ab_shops', () => {
    expect(code.match(/add column if not exists/gi)).toHaveLength(2);
    expect(code).toContain('alter table public.ab_shops add column if not exists site_base_url text;');
    expect(code).toContain('alter table public.ab_shops add column if not exists site_look jsonb;');
  });

  it('grants nothing: the base URL is never owner-writable', () => {
    expect(code).not.toMatch(/\bgrant\b/i);
    expect(code).not.toMatch(/\bpolicy\b/i);
    expect(s).not.toMatch(/\bdrop\b/i);
    expect(s).not.toMatch(/\bdelete\b/i);
    expect(s).not.toMatch(/\btruncate\b/i);
  });

  it('constrains the base URL to an https origin that every value pickPublicBase makes satisfies', () => {
    const m = /site_base_url ~ '([^']+)'/.exec(code);
    expect(m).not.toBeNull();
    const re = new RegExp(m![1]);
    for (const ok of [pickPublicBase([{ name: 'freshcuts.com', verified: true }], () => true), pickPublicBase([{ name: 'Fresh-Cuts-abc.vercel.app', verified: true }], () => false)]) {
      expect(re.test(ok!)).toBe(true);
    }
    for (const bad of ['http://x.com', 'https://x.com/path', 'https://x.com?q', 'javascript:x', 'https://']) expect(re.test(bad)).toBe(false);
  });
});
