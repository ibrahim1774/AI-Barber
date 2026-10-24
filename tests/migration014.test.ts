import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Static checks on 014_ios_links_due.sql (e2e M1): one server-only column and its index.
const s = fs.readFileSync(path.join(__dirname, '../supabase/migrations/014_ios_links_due.sql'), 'utf8');
const code = s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').replace(/\s+/g, ' ').trim();

describe('014_ios_links_due.sql', () => {
  it('adds only links_due_at to ios_purchases, with a partial index', () => {
    expect(code.match(/add column if not exists/gi)).toHaveLength(1);
    expect(code).toContain('alter table public.ios_purchases add column if not exists links_due_at timestamptz;');
    expect(code).toMatch(/create index if not exists ios_purchases_links_due_idx on public\.ios_purchases \(links_due_at\) where links_due_at is not null;/);
  });

  it('grants nothing and destroys nothing', () => {
    expect(code).not.toMatch(/\bgrant\b|\bpolicy\b/i);
    expect(code).not.toMatch(/\bdrop\b|\bdelete\b|\btruncate\b/i);
  });
});
