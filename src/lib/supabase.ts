import 'react-native-url-polyfill/auto';

import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';
import { authStorageKey, createDefaultAuthStorage, wireAutoRefresh } from '@/lib/authSession';

// The aibarber.org project (lyjruphvzfwbtzfwfvwm): the same users and `sites` table as the web.
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const AUTH_STORAGE_KEY = authStorageKey(SUPABASE_URL || 'https://placeholder.supabase.co');
/** Keychain-backed; waits for the first-launch-after-install check before any read (authSession.ts). */
export const authStorage = createDefaultAuthStorage(SUPABASE_URL || 'https://placeholder.supabase.co');

export const supabaseConfigured = SUPABASE_URL.length > 0 && SUPABASE_KEY.length > 0;

// Implicit flow, like the web client: the password-reset email links to
// aibarber.org, which has no PKCE code verifier from this phone.
export const supabase = createClient(SUPABASE_URL || 'https://placeholder.supabase.co', SUPABASE_KEY || 'placeholder', {
  auth: { storage: authStorage, autoRefreshToken: true, persistSession: true, detectSessionInUrl: false },
});

wireAutoRefresh(supabase.auth, AppState);
