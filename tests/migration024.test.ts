import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Static checks on 024_web_app_dedupe.sql: additive, idempotent, locked to the service role.
const s = fs.readFileSync(path.join(__dirname, '../supabase/migrations/024_web_app_dedupe.sql'), 'utf8');
const code = s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').replace(/\s+/g, ' ').trim();

describe('024_web_app_dedupe.sql', () => {
  it('creates web_app_customers idempotently, keyed by (user_id, environment)', () => {
    expect(code).toMatch(/create table if not exists public\.web_app_customers/i);
    expect(code).toMatch(/user_id uuid not null/i);
    expect(code).toMatch(/environment text not null check \(environment in \('live','test'\)\)/i);
    expect(code).toMatch(/stripe_customer_id text not null/i);
    expect(code).toMatch(/primary key \(user_id, environment\)/i);
  });

  it('adds the bookkeeping columns as nullable, idempotent additions', () => {
    for (const c of ['dup_of text', 'dup_alerted_at timestamptz', 'dup_refunded_at timestamptz', 'ios_overlap_notified_at timestamptz', 'ios_overlap_checked_at timestamptz']) {
      expect(code).toMatch(new RegExp(`alter table public\\.web_app_entitlements add column if not exists ${c};`, 'i'));
    }
  });

  it('enables RLS and revokes anon/authenticated', () => {
    expect(code).toMatch(/alter table public\.web_app_customers enable row level security/i);
    expect(code).toMatch(/revoke all on public\.web_app_customers from anon, authenticated/i);
  });

  it('is additive: no drops, deletes, type changes, triggers, policies, grants or other tables', () => {
    expect(code).not.toMatch(/\bdrop\b|\bdelete\b|\btruncate\b|\bgrant\b|\bpolicy\b|\btrigger\b|alter column|\btype\b|\bupdate\b|references|set not null/i);
    const alters = code.match(/alter table [a-z_.]+/gi) ?? [];
    for (const a of alters) expect(a).toMatch(/public\.(web_app_customers|web_app_entitlements)$/i);
  });
});
