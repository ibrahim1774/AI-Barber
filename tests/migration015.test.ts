import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Static checks on 015/016 (team profiles). The behaviour itself (limits, ownership, trigger,
// revoke) is run against PGlite by supabase/tests/p2-members-pglite.mjs, outside the suite.
const M = path.join(__dirname, '../supabase/migrations');
const code = (f: string) => fs.readFileSync(path.join(M, f), 'utf8').split('\n').filter((l) => !l.trim().startsWith('--')).join('\n').replace(/\s+/g, ' ');

describe('015_members_profile.sql', () => {
  const s = code('015_members_profile.sql');
  it('adds nullable title and booking_url with the spec checks, idempotently', () => {
    expect(s).toContain('add column if not exists title text;');
    expect(s).toContain('add column if not exists booking_url text;');
    expect(s).toMatch(/title is null or char_length\(title\) <= 80/);
    expect(s).toMatch(/booking_url is null or \(booking_url ~\* '\^https\?:\/\/' and char_length\(booking_url\) <= 2048\)/);
    expect(s).toMatch(/if not exists \(select 1 from pg_constraint where conname = 'ab_members_title_len'/);
    expect(s).toMatch(/if not exists \(select 1 from pg_constraint where conname = 'ab_members_booking_url_http'/);
  });
  it('ab_add_member locks the shop row, counts after the lock, checks ownership, service_role only', () => {
    expect(s).toMatch(/security definer set search_path = public/);
    expect(s).toMatch(/where id = p_shop and owner_id = p_owner for update/);
    expect(s.indexOf('for update')).toBeLessThan(s.indexOf('select count(*)'));
    expect(s).not.toMatch(/count\(\*\)[^;]*for update/);
    expect(s).toMatch(/if v_count >= p_limit then raise exception 'member-limit'/);
    expect(s).toMatch(/revoke all on function public\.ab_add_member\(uuid, uuid, int, text, text, text, text, text\) from public, anon, authenticated;/);
    expect(s).toMatch(/grant execute on function public\.ab_add_member\(uuid, uuid, int, text, text, text, text, text\) to service_role;/);
  });
  it('guards reactivation and re-states grants; never revokes INSERT, drops data or deactivates', () => {
    expect(s).toMatch(/old\.active is not true and new\.active is true and current_user in \('authenticated', 'anon'\)/);
    expect(s).toMatch(/grant select, update, delete on public\.ab_members to authenticated;/);
    expect(s).not.toMatch(/revoke insert/i);
    expect(s).not.toMatch(/\bdrop (table|column)\b|\bdelete from\b|\btruncate\b|set active\s*=\s*false/i);
  });
});

describe('016_members_revoke_insert.sql', () => {
  const raw = fs.readFileSync(path.join(M, '016_members_revoke_insert.sql'), 'utf8');
  const s = code('016_members_revoke_insert.sql');
  it('only revokes INSERT from authenticated and says to apply it after the new app build is installed', () => {
    expect(s).toContain('revoke insert on public.ab_members from authenticated;');
    expect(s).not.toMatch(/\bdrop\b|\bdelete from\b|\btruncate\b|\balter\b|\bupdate ab_members\b/i);
    expect(raw.split('\n').slice(0, 8).join('\n')).toMatch(/NOT APPLIED until the\s+-- new app build .* is INSTALLED/s);
  });
});
