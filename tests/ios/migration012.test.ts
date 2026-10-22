import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { DOMAIN_STATES, SITE_HOLDING_STATES } from '../../lib/ios/domainsRepo.js';

// Static checks on 012_custom_domains.sql (written, not applied).
const s = fs.readFileSync(path.join(__dirname, '../../supabase/migrations/012_custom_domains.sql'), 'utf8');
const code = s.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');

describe('012_custom_domains.sql', () => {
  it('creates ios_domains only, nothing else touched', () => {
    expect(code.match(/create table public\.(\w+)/g)).toEqual(['create table public.ios_domains']);
    expect(code).not.toMatch(/ios_purchases/);
    expect(code).not.toMatch(/\balter table public\.(?!ios_domains)/);
  });

  it('a row is an Apple or a Stripe subscription; bought with auto-renew off by default', () => {
    expect(code).toMatch(/source text not null default 'apple' check \(source in \('apple', 'stripe'\)\)/);
    expect(code).toMatch(/auto_renew boolean not null default false/);
  });

  it('RLS on and no policies or grants (service role only)', () => {
    expect(code).toMatch(/alter table public\.ios_domains enable row level security;/);
    expect(s).not.toMatch(/create policy/i);
    expect(s).not.toMatch(/\bgrant\b/i);
  });

  it('has no drop, delete or truncate', () => {
    expect(s).not.toMatch(/\bdrop\b/i);
    expect(s).not.toMatch(/\bdelete\b/i);
    expect(s).not.toMatch(/\btruncate\b/i);
  });

  it('the state check lists exactly the states the code uses', () => {
    const m = code.match(/state in \(([^)]*)\)\)/);
    const states = m![1].match(/'([a-z]+)'/g)!.map((x) => x.replace(/'/g, ''));
    expect(states).toEqual([...DOMAIN_STATES]);
  });

  it('domain unique among non-failed REAL rows (Sandbox rows never squat a name); one holding row per site', () => {
    expect(code).toMatch(/create unique index ios_domains_domain_key on public\.ios_domains \(domain\) where state <> 'failed' and not simulated;/);
    const site = code.match(/ios_domains_site_key[\s\S]*?where state in \(([^)]*)\)/)!;
    expect(site[1].match(/'([a-z]+)'/g)!.map((x) => x.replace(/'/g, ''))).toEqual([...SITE_HOLDING_STATES]);
  });

  it('the subscription key is the primary key (one subscription, one slot: single use)', () => {
    expect(code).toMatch(/original_transaction_id text primary key/);
  });

  it('says it is not applied', () => expect(s).toMatch(/NOT APPLIED/));
});
