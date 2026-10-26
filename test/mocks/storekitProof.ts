/** Jest stand-in for src/lib/storekitProof: no native module. Use with jest.mock('@/lib/storekitProof', () => require('.../storekitProof')). */
export const getCurrentEntitlementProof = jest.fn(async (): Promise<{ jws: string; originalTransactionId: string } | null> => null);
