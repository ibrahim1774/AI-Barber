// Review 6d NIT 4 and 5 (mutants Z and AC) pinned. No network.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DRAFT_APPROVAL_TTL_MS } from '../../lib/serviceCopy/approval';
import { blockNetwork, rig, scriptedModel, site } from './helpers';

let net: ReturnType<typeof blockNetwork>;
beforeEach(() => { net = blockNetwork(); });
afterEach(() => { expect(net).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe('approval and cache pins', () => {
  it('the draft approval lives exactly 30 days (an edit of the constant is a decision, not a refactor)', () => {
    expect(DRAFT_APPROVAL_TTL_MS).toBe(30 * 86_400_000);
  });
  it('a cached family that is no longer among the title\'s candidates is never returned: it is dropped and the title is asked again', async () => {
    const fam = (family: string) => JSON.stringify({ family });
    const r = rig({ siteData: site({}, ['Mohawk']), model: scriptedModel([fam('haircut'), fam('haircut')]) });
    const first = await r.call({ titleKey: 'mohawk' }, { raw: true });
    expect(first.body).toEqual({ status: 'family', titleKey: 'mohawk', family: 'haircut' });
    const row = [...r.store.rows.values()][0] as { copy: { family: string } };
    row.copy = { ...row.copy, family: 'fade' };           // a stale/forged cached value outside the candidate set
    const again = await r.call({ titleKey: 'mohawk' }, { raw: true });
    expect(again.body).toEqual({ status: 'family', titleKey: 'mohawk', family: 'haircut' });
    expect(JSON.stringify(again.body)).not.toContain('fade');
    expect(r.model.calls.length).toBe(2);
  });
});
