import { createClient } from '@supabase/supabase-js';
import { createVerdentAuth } from '@verdent/auth-js';

/**
 * Verdent-managed Supabase.
 * - Verdent preview/publish інжектить VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY,
 *   застосунок ходить напряму.
 * - Без env (локальний запуск) — same-origin BaaS-проксі Verdent.
 */
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL ?? window.location.origin;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? 'verdent-baas-proxy';

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

const oauthAuthorizeUrl = import.meta.env.VITE_VERDENT_OAUTH_INITIATE_URL;

export const auth = createVerdentAuth({
  supabase,
  ...(oauthAuthorizeUrl ? { oauth: { authorizeUrl: oauthAuthorizeUrl } } : {}),
});

export function openSignIn() {
  auth.openSignInModal({
    appName: 'LocalChats · Sales Console',
    theme: 'dark',
    primaryColor: '#f0b429',
  });
}
