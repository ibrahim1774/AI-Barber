import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Static checks on the bookings migrations. The privilege behaviour itself (005 → 008, re-runs,
// owner access) is verified against PGlite outside the suite; these keep the files honest.
const M = path.join(__dirname, '../../supabase/migrations');
const sql = (n: string) => fs.readFileSync(path.join(M, n), 'utf8');
const code = (s: string) => s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

describe('008_bookings_hardening.sql', () => {
  const s = code(sql('008_bookings_hardening.sql'));

  it("re-states 006's owner column grants on ab_shops", () => {
    expect(s).toMatch(/grant update \(address, phone, accent, daily_summary\) on public\.ab_shops to authenticated;/);
    expect(code(sql('006_bookings_api.sql'))).toMatch(/grant update \(address, phone, accent, daily_summary\) on public\.ab_shops to authenticated;/);
  });

  it('revokes DELETE on ab_shops from authenticated', () => {
    expect(s).toMatch(/revoke delete on public\.ab_shops from authenticated;/);
  });

  it('is privileges only (idempotent): no table-level grant, no DDL', () => {
    expect(s).not.toMatch(/grant (all|update|insert|delete)\s+on/i);
    expect(s).not.toMatch(/\b(create|alter|drop)\b/i);
  });
});

describe('005_bookings_foundation.sql', () => {
  it('says 006–009 must be re-run after it', () => {
    expect(sql('005_bookings_foundation.sql')).toMatch(/re-run 006, 007, 008 and 009 after it/);
  });
});

describe('042_require_card.sql', () => {
  const raw = sql('042_require_card.sql');
  const s = code(raw);
  it('says do not apply until the owner says so', () => {
    expect(raw).toMatch(/do not apply until the owner says so/);
  });
  it('is additive: one new column, default false, not null', () => {
    expect(s).toMatch(/alter table public\.ab_shops add column if not exists require_card bool not null default false;/);
    expect(s).not.toMatch(/\b(drop|delete|truncate|rename)\b/i);
  });
  it('adds card_checkout_failed_at (nullable timestamptz) with NO grant to authenticated (server-written only)', () => {
    expect(s).toMatch(/alter table public\.ab_shops add column if not exists card_checkout_failed_at timestamptz null;/);
    expect(s).not.toMatch(/grant[^;]*card_checkout_failed_at/i);
    expect((s.match(/\balter table\b/gi) ?? []).length).toBe(2);
  });
  it('lets owners write it through a column grant only', () => {
    expect(s).toMatch(/grant update \(require_card\) on public\.ab_shops to authenticated;/);
    expect(s).not.toMatch(/grant (all|insert|delete)/i);
  });
  it('runs in one transaction with a lock timeout', () => {
    expect(s).toMatch(/begin;[\s\S]*set local lock_timeout[\s\S]*commit;/);
  });
});
