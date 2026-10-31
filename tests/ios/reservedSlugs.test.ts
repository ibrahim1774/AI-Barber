// Apple audit PR #261, re-review C1-R: reserved / draft-shaped slugs never bind and never delete a shared folder.
import { describe, it, expect, vi } from 'vitest';
import { isReservedSlug } from '../../lib/ios/reservedSlugs.js';
import { chooseSlug, makeIsTaken } from '../../lib/ios/slug.js';
import { slugify } from '../../lib/publishSite.js';

const UUID = '3f2b8c1e-9d4a-4b7e-8a61-0c5d2e7f9a10';

describe('isReservedSlug', () => {
  it.each(['ios-drafts', 'ab-products', 'pending-sites', 'pending-sites-history', 'admin-republish-runs',
    'IOS-DRAFTS', 'Ab-Products', 'ios_drafts', 'ios drafts', 'iosdrafts', 'ios-drafts/', 'ios-drafts//', '-ios-drafts-',
    'ｉｏｓ-ｄｒａｆｔｓ', // fullwidth lookalikes fold under NFKC
    UUID, UUID.toUpperCase(), `${UUID}/`, '', '   ', '///'])('%j is reserved', (s) => {
    expect(isReservedSlug(s)).toBe(true);
  });
  it.each(['fresh-cuts', 'ios-drafts-ab12', 'ab-products-2', 'ios-test-fresh-cuts', 'cuts-3f2b8c1e', 'drafts'])('%j is allowed', (s) => {
    expect(isReservedSlug(s)).toBe(false);
  });
  it('non-strings are reserved', () => { expect(isReservedSlug(undefined)).toBe(true); expect(isReservedSlug(5)).toBe(true); });
});

describe('chooseSlug never binds a reserved base', () => {
  const never = async () => false;
  it.each([['ios drafts', 'ios-drafts'], ['AB Products', 'ab-products'], [UUID, UUID], ['Pending Sites', 'pending-sites']])('%j', async (name, bad) => {
    const s = await chooseSlug(name, 'Production', never, () => 'zz12');
    expect(s).toBe(`${bad}-zz12`);
    expect(isReservedSlug(s)).toBe(false);
  });
  it('a reserved candidate is skipped even if the suffix would reserve it', async () => {
    await expect(chooseSlug('ios drafts', 'Production', never, () => 'zz12')).resolves.toBe('ios-drafts-zz12');
  });
  it('unicode lookalike names slugify to something reserved and are suffixed', async () => {
    const name = 'Ios‑Drafts'; // non-breaking hyphen
    expect(slugify(name)).toBe('ios-drafts');
    expect((await chooseSlug(name, 'Production', never, () => 'q1q1'))).toBe('ios-drafts-q1q1');
  });
  it('trailing slash in the name', async () => {
    expect(await chooseSlug('ab-products/', 'Production', never, () => 'q1q1')).toBe('ab-products-q1q1');
  });
});

describe('makeIsTaken collisions', () => {
  const base = { pendingExists: async () => false, repoTaken: async () => false, projectExists: async () => false, urlServes: async () => false };
  it('reserved slugs are always taken, without any lookups', async () => {
    const projectExists = vi.fn(async () => false);
    expect(await makeIsTaken({ ...base, projectExists })('ios-drafts')).toBe(true);
    expect(projectExists).not.toHaveBeenCalled();
  });
  it('a slug whose bucket folder already holds objects (another site or draft) is taken', async () => {
    expect(await makeIsTaken({ ...base, prefixInUse: async (s) => s === 'victim' })('victim')).toBe(true);
    expect(await makeIsTaken({ ...base, prefixInUse: async () => false })('victim')).toBe(false);
  });
  it('chooseSlug suffixes around a slug whose folder is in use', async () => {
    const isTaken = makeIsTaken({ ...base, prefixInUse: async (s) => s === 'fresh-cuts' });
    expect(await chooseSlug('Fresh Cuts', 'Production', isTaken, () => 'ab12')).toBe('fresh-cuts-ab12');
  });
  it('a bucket error propagates (fail closed)', async () => {
    await expect(makeIsTaken({ ...base, prefixInUse: async () => { throw new Error('gcs down'); } })('x')).rejects.toThrow('gcs down');
  });
});
