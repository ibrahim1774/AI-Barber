import 'react-native-url-polyfill/auto';

import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';

/** Sessions live in the keychain (Crew Lens's pattern), not in kv-store. */
const storage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
};

// The aibarber.org project (lyjruphvzfwbtzfwfvwm): the same users and `sites` table as the web.
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const supabaseConfigured = SUPABASE_URL.length > 0 && SUPABASE_KEY.length > 0;

// Implicit flow, like the web client: the password-reset email links to
// aibarber.org, which has no PKCE code verifier from this phone.
export const supabase = createClient(SUPABASE_URL || 'https://placeholder.supabase.co', SUPABASE_KEY || 'placeholder', {
  auth: { storage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});
