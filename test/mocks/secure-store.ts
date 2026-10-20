/** In-memory stand-in for expo-secure-store under Jest. */
const store = new Map<string, string>();
export const getItemAsync = async (k: string) => store.get(k) ?? null;
export const setItemAsync = async (k: string, v: string) => {
  store.set(k, v);
};
export const deleteItemAsync = async (k: string) => {
  store.delete(k);
};
