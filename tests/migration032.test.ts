import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const s = fs.readFileSync(path.join(__dirname, '../supabase/migrations/032_customer_contacts.sql'), 'utf8');
const code = s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').replace(/\s+/g, ' ').trim();

describe('032_customer_contacts.sql', () => {
  it('creates customer_contacts idempotently, one row per auth user', () => {
    expect(code).toMatch(/create table if not exists public\.customer_contacts/i);
    expect(code).toMatch(/user_id uuid primary key references auth\.users\(id\) on delete cascade/i);
    expect(code).toContain("phone_e164 text not null check (phone_e164 ~ '^\\+[1-9][0-9]{7,14}$')");
    expect(code).toContain("source in ('post_pay_web','signup_web','admin','backfill')");
    expect(code).toMatch(/auth_phone_synced boolean not null default false/i);
    expect(code).toMatch(/create index if not exists customer_contacts_phone_idx/i);
  });
  it('is service-role only', () => {
    expect(code).toMatch(/alter table public\.customer_contacts enable row level security/i);
    expect(code).toMatch(/revoke all on public\.customer_contacts from anon, authenticated/i);
    expect(code).toMatch(/grant all on public\.customer_contacts to service_role/i);
  });
  it('only adds nullable columns to web_app_sites', () => {
    expect(code).toMatch(/alter table public\.web_app_sites add column if not exists contact_phone text;/i);
    expect(code).toMatch(/alter table public\.web_app_sites add column if not exists contact_phone_at timestamptz;/i);
    expect(code).not.toMatch(/drop |delete |truncate /i);
  });
});
