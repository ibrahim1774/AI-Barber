import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Static checks on 010_tiers.sql: one nullable column, nothing else.
const s = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/010_tiers.sql'), 'utf8');
const code = s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').replace(/\s+/g, ' ').trim();

describe('010_tiers.sql', () => {
  it('is exactly one add column if not exists on ios_purchases', () => {
    expect(code).toBe('alter table public.ios_purchases add column if not exists product_purchased_at timestamptz;');
    expect(s.match(/add column if not exists/gi)).toHaveLength(1);
  });

  it('has no drop, delete or grant anywhere, comments included', () => {
    expect(s).not.toMatch(/\bdrop\b/i);
    expect(s).not.toMatch(/\bdelete\b/i);
    expect(s).not.toMatch(/\bgrant\b/i);
    expect(s).not.toMatch(/\brevoke\b/i);
  });

  it('has a comment', () => expect(s).toMatch(/^--/m));
});
