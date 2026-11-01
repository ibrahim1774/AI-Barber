// This registry is used only by the browser upload wrappers after reliability rollout.
let pending = 0;
export const pendingWebAssets = () => pending;
export async function withPendingWebAsset<T>(run: () => Promise<T>): Promise<T> {
  pending++;
  try { return await run(); } finally { pending--; }
}
