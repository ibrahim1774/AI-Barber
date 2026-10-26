import { getCurrentEntitlementProof } from '@/lib/storekitProof';

const mockRequire = jest.fn();
jest.mock('expo', () => ({ requireOptionalNativeModule: (...a: unknown[]) => mockRequire(...a) }));

describe('storekit-proof wrapper', () => {
  beforeEach(() => mockRequire.mockReset());
  test('module missing (jest, simulator, Android): null', async () => {
    mockRequire.mockReturnValue(null);
    expect(await getCurrentEntitlementProof()).toBeNull();
    expect(mockRequire).toHaveBeenCalledWith('StorekitProof');
  });
  test('returns the native result', async () => {
    mockRequire.mockReturnValue({ getCurrentEntitlementJWS: async () => ({ jws: 'a.b.c', originalTransactionId: '2000' }) });
    expect(await getCurrentEntitlementProof()).toEqual({ jws: 'a.b.c', originalTransactionId: '2000' });
  });
  test('no entitlement / malformed / throwing native: null, never throws', async () => {
    mockRequire.mockReturnValue({ getCurrentEntitlementJWS: async () => null });
    expect(await getCurrentEntitlementProof()).toBeNull();
    mockRequire.mockReturnValue({ getCurrentEntitlementJWS: async () => ({ jws: '', originalTransactionId: '1' }) });
    expect(await getCurrentEntitlementProof()).toBeNull();
    mockRequire.mockReturnValue({ getCurrentEntitlementJWS: async () => { throw new Error('x'); } });
    expect(await getCurrentEntitlementProof()).toBeNull();
    mockRequire.mockImplementation(() => { throw new Error('no native'); });
    expect(await getCurrentEntitlementProof()).toBeNull();
  });
});
