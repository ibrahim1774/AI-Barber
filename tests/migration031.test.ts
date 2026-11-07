import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Static checks on 031_web_app_signup_nudges.sql: additive, idempotent, locked to the service role.
const s = fs.readFileSync(path.join(__dirname, '../supabase/migrations/031_web_app_signup_nudges.sql'), 'utf8');
const code = s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').replace(/\s+/g, ' ').trim();

describe('031_web_app_signup_nudges.sql', () => {
  it('creates web_app_signup_nudges idempotently, keyed by (user_id, environment)', () => {
    expect(code).toMatch(/create table if not exists public\.web_app_signup_nudges/i);
    expect(code).toMatch(/user_id uuid not null references auth\.users\(id\) on delete cascade/i);
    expect(code).toMatch(/environment text not null check \(environment in \('live','test'\)\)/i);
    expect(code).toMatch(/primary key \(user_id, environment\)/i);
    for (const c of ['step1_sent_at timestamptz', 'step2_sent_at timestamptz', 'step3_sent_at timestamptz', 'claimed_step smallint', 'claimed_at timestamptz', "links_used jsonb not null default '\\{\\}'::jsonb", 'stopped_at timestamptz', 'last_checked_at timestamptz']) {
      expect(code).toMatch(new RegExp(c, 'i'));
    }
    for (const r of ['paid', 'deleted', 'suppressed', 'not_web', 'live', 'expired', 'done', 'before_launch', 'bad_address']) expect(code).toContain(`'${r}'`);
  });

  it('creates web_app_email_suppressions idempotently, keyed by lowercased email', () => {
    expect(code).toMatch(/create table if not exists public\.web_app_email_suppressions/i);
    expect(code).toMatch(/email text primary key/i);
    expect(code).toMatch(/reason in \('unsubscribe','bounce','complaint'\)/i);
  });

  it('enables RLS, revokes anon/authenticated and grants only service_role, on both tables', () => {
    for (const t of ['web_app_signup_nudges', 'web_app_email_suppressions']) {
      expect(code).toMatch(new RegExp(`alter table public\\.${t} enable row level security`, 'i'));
      expect(code).toMatch(new RegExp(`revoke all on public\\.${t} from anon, authenticated`, 'i'));
      expect(code).toMatch(new RegExp(`grant all on public\\.${t} to service_role`, 'i'));
    }
    expect(code).not.toMatch(/\bpolicy\b|to (anon|authenticated|public)\b/i);
  });

  it('is additive: no drops, deletes, updates, triggers, type changes, and no alter of existing tables', () => {
    expect(code).not.toMatch(/\bdrop\b|\bdelete from\b|\btruncate\b|\btrigger\b|alter column|\bupdate\b|set not null|add column/i);
    const alters = code.match(/alter table [a-z_.]+/gi) ?? [];
    for (const a of alters) expect(a).toMatch(/public\.(web_app_signup_nudges|web_app_email_suppressions)$/i);
    const creates = code.match(/create (?:table|index|function)(?: if not exists)? [a-z_.0-9]+/gi) ?? [];
    for (const c of creates) expect(c).toMatch(/web_app_signup_nudges|web_app_email_suppressions/i);
  });
});
