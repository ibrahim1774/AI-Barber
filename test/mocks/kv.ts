/** In-memory stand-in for expo-sqlite/kv-store under Jest. */
const store = new Map<string, string>();
const Storage = {
  getItem: async (k: string): Promise<string | null> => store.get(k) ?? null,
  setItem: async (k: string, v: string): Promise<void> => {
    store.set(k, v);
  },
  removeItem: async (k: string): Promise<boolean> => store.delete(k),
};
export default Storage;
export { Storage };
