import { NextRequest, NextResponse } from 'next/server';
import { createMiddlewareClient, isSupabaseConfigured } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') || '/cheques';

  const redirectUrl = url.clone();
  redirectUrl.pathname = next;
  redirectUrl.search = '';
  const response = NextResponse.redirect(redirectUrl);

  if (!isSupabaseConfigured() || !code) {
    return response;
  }

  const supabase = createMiddlewareClient(request, response);
  await supabase.auth.exchangeCodeForSession(code);

  return response;
}
