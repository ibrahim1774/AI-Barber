import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Static checks on 018_ios_purchases_user_id.sql: additive, idempotent, never re-points a link,
// the review/verification SELECTs stay comments.
const s = fs.readFileSync(path.join(__dirname, '../supabase/migrations/018_ios_purchases_user_id.sql'), 'utf8');
const code = s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').replace(/\s+/g, ' ').trim();

describe('018_ios_purchases_user_id.sql', () => {
  it('adds user_id idempotently with the auth.users reference and a non-unique partial index', () => {
    expect(code).toMatch(/add column if not exists user_id uuid references auth\.users \(id\) on delete set null/i);
    expect(code).toMatch(/create index if not exists ios_purchases_user_id_idx on public\.ios_purchases \(user_id\) where user_id is not null;/);
    expect(code).not.toMatch(/create unique index/i);
  });

  it('backfills only unowned rows, from ab_shops first and then from an unambiguous sites row', () => {
    const updates = code.match(/update public\.ios_purchases p set user_id = [^;]*;/gi) || [];
    expect(updates).toHaveLength(2);
    for (const u of updates) expect(u).toMatch(/p\.user_id is null/i);
    expect(updates[0]).toMatch(/ab_shops s where s\.ios_otid = p\.original_transaction_id/i);
    expect(updates[1]).toMatch(/having count\(distinct st\.user_id\) = 1/i);
  });

  it('destroys nothing, grants nothing, and keeps every review/verification query as a comment', () => {
    expect(code).not.toMatch(/\bdrop\b|\bdelete from\b|\btruncate\b|\bgrant\b|\bpolicy\b/i);
    expect(s).toContain('(V1)');
    expect(s).toContain('(V4)');
    expect(code.match(/\bselect count\(\*\)/gi)).toBeNull();
  });
});
