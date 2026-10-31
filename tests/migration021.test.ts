import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Static checks on 021_web_app_sites.sql: additive, idempotent, locked to the service role.
const s = fs.readFileSync(path.join(__dirname, '../supabase/migrations/021_web_app_sites.sql'), 'utf8');
const code = s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').replace(/\s+/g, ' ').trim();

describe('021_web_app_sites.sql', () => {
  it('creates the table idempotently with slug as primary key and the required columns', () => {
    expect(code).toMatch(/create table if not exists public\.web_app_sites/i);
    expect(code).toMatch(/slug text primary key/i);
    expect(code).toMatch(/stripe_subscription_id text not null/i);
    expect(code).toMatch(/user_id uuid not null/i);
    expect(code).toMatch(/environment text not null check \(environment in \('live','test'\)\)/i);
    for (const c of ['published_at', 'taken_down_at', 'removed_at', 'lapse_checked_at']) {
      expect(code).toMatch(new RegExp(`${c} timestamptz[,)]`, 'i'));
    }
    expect(code).toMatch(/created_at timestamptz not null default now\(\)/i);
    expect(code).toMatch(/updated_at timestamptz not null default now\(\)/i);
  });

  it('indexes user_id, enables RLS and revokes anon/authenticated', () => {
    expect(code).toMatch(/create index if not exists web_app_sites_user_idx on public\.web_app_sites \(user_id\)/i);
    expect(code).toMatch(/alter table public\.web_app_sites enable row level security/i);
    expect(code).toMatch(/revoke all on public\.web_app_sites from anon, authenticated/i);
  });

  it('is additive: no foreign keys, drops, deletes or grants, nothing touches other tables', () => {
    expect(code).not.toMatch(/references|\bdrop\b|\bdelete\b|\btruncate\b|\bgrant\b|\bpolicy\b|alter table (?!public\.web_app_sites)/i);
  });
});
