import { NextRequest, NextResponse } from 'next/server';
import { createMiddlewareClient, isSupabaseConfigured } from '@/lib/supabase/server';

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  const redirect = url.clone();
  redirect.pathname = '/login';
  redirect.search = '';
  const response = NextResponse.redirect(redirect, { status: 303 });

  if (isSupabaseConfigured()) {
    const supabase = createMiddlewareClient(request, response);
    await supabase.auth.signOut();
  }

  return response;
}
