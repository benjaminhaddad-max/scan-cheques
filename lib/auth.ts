import { NextRequest, NextResponse } from 'next/server';
import { createRequestClient, isSupabaseConfigured } from './supabase/server';

export interface AuthResult {
  success: boolean;
  user?: { id: string; email?: string };
  errorResponse?: NextResponse;
}

export async function requireAuth(request: NextRequest): Promise<AuthResult> {
  if (!isSupabaseConfigured()) {
    return {
      success: true,
      user: { id: 'anonymous', email: 'anonymous@local' },
    };
  }

  const supabase = createRequestClient(request);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    return {
      success: false,
      errorResponse: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  return {
    success: true,
    user: { id: user.id, email: user.email ?? undefined },
  };
}
