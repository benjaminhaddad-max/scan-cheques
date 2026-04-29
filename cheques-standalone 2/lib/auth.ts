import { NextRequest, NextResponse } from 'next/server';

/**
 * ⚠️ STUB D'AUTHENTIFICATION ⚠️
 *
 * TODO: replace this stub with your own auth (e.g. Supabase).
 * Currently returns success unconditionally for development purposes.
 *
 * Pour brancher Supabase Auth, voir SETUP.md section "Branchement Supabase Auth".
 * En résumé :
 *   1. Installer `@supabase/supabase-js` et `@supabase/ssr`
 *   2. Créer un helper `createServerClient` qui lit les cookies de la requête
 *   3. Appeler `supabase.auth.getUser()` pour obtenir l'utilisateur
 *   4. Retourner `{ success: false, errorResponse: 401 }` si pas d'utilisateur
 *
 * Tant que ce stub est en place, toutes les routes API sont accessibles
 * sans authentification — NE PAS DÉPLOYER EN PRODUCTION TEL QUEL.
 */
export interface AuthResult {
  success: boolean;
  user?: { id: string; email?: string };
  errorResponse?: NextResponse;
}

export async function requireAuth(_request: NextRequest): Promise<AuthResult> {
  // TODO: replace this stub with your own auth (e.g. Supabase).
  // Currently returns success unconditionally for development purposes.
  return {
    success: true,
    user: {
      id: 'stub-user',
      email: 'dev@example.com',
    },
  };
}
