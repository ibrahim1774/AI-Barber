import { describe, it, expect, vi, afterEach } from 'vitest';
import { liveTransferDeps } from '../../lib/ios/transferLive.js';

afterEach(() => { vi.unstubAllEnvs(); });

describe('IOS_REQUIRE_TRANSFER_PROOF', () => {
  it('defaults OFF; on for 1/true/on/yes', () => {
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'k');
    vi.stubEnv('IOS_REQUIRE_TRANSFER_PROOF', '');
    expect(liveTransferDeps().requireProof).toBe(false);
    for (const v of ['0', 'false', 'off', 'no', 'maybe']) { vi.stubEnv('IOS_REQUIRE_TRANSFER_PROOF', v); expect(liveTransferDeps().requireProof).toBe(false); }
    for (const v of ['1', 'true', 'TRUE', 'on', 'yes']) { vi.stubEnv('IOS_REQUIRE_TRANSFER_PROOF', v); expect(liveTransferDeps().requireProof).toBe(true); }
  });
  it('the bundle id comes from APPLE_BUNDLE_ID', () => {
    vi.stubEnv('APPLE_BUNDLE_ID', 'com.x.y');
    expect(liveTransferDeps().bundleId).toBe('com.x.y');
  });
});
