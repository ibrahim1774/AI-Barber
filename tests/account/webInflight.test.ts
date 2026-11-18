import { describe, expect, it, vi } from 'vitest';
import { webPublishInProgress, type InflightDeps } from '../../lib/account/webInflight.js';
import { MAX_JOB_ATTEMPTS } from '../../lib/webApp/publishJobs.js';

const NOW = Date.parse('2026-11-18T12:00:00Z');
const mk = (o: { running?: boolean; failed?: boolean; lease?: any; throws?: any } = {}): InflightDeps & { asked: string[] } => {
  const asked: string[] = [];
  return {
    asked, now: () => NOW,
    intents: async (_u, _m, filter) => { asked.push(filter); if (o.throws) throw o.throws; return filter.includes('queued') ? (o.running ? [{ id: 'a' }] : []) : (o.failed ? [{ id: 'b' }] : []); },
    lease: async () => o.lease ?? null,
  };
};
describe('webPublishInProgress', () => {
  it('nothing running: false (and the exact filters are the real columns)', async () => {
    const d = mk();
    expect(await webPublishInProgress('u', 'Production', d)).toBe(false);
    expect(d.asked).toEqual(['status=in.(queued,running)', `status=eq.failed&attempts=lt.${MAX_JOB_ATTEMPTS}`]);
  });
  it('a queued or running intent, a retryable failed intent, or a live lease is in progress; an expired lease is not', async () => {
    expect(await webPublishInProgress('u', 'Production', mk({ running: true }))).toBe(true);
    expect(await webPublishInProgress('u', 'Production', mk({ failed: true }))).toBe(true);
    expect(await webPublishInProgress('u', 'Production', mk({ lease: { publish_lease: 'x', lease_until: new Date(NOW + 60_000).toISOString() } }))).toBe(true);
    expect(await webPublishInProgress('u', 'Production', mk({ lease: { publish_lease: 'x', lease_until: new Date(NOW - 60_000).toISOString() } }))).toBe(false);
  });
  it('a failed lookup counts as in progress; missing tables mean no job', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await webPublishInProgress('u', 'Production', mk({ throws: Object.assign(new Error('x'), { status: 500 }) }))).toBe(true);
    expect(await webPublishInProgress('u', 'Production', mk({ throws: Object.assign(new Error('x'), { status: 404 }) }))).toBe(false);
  });
  it('maps Production to live and Sandbox to test', async () => {
    const seen: string[] = []; const d = mk(); const orig = d.intents; d.intents = async (u, m, f) => { seen.push(m); return orig(u, m, f); };
    await webPublishInProgress('u', 'Sandbox', d); await webPublishInProgress('u', 'Production', d);
    expect([...new Set(seen)]).toEqual(['test', 'live']);
  });
});
