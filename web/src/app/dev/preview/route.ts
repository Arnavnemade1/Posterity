import { NextResponse } from 'next/server';

/** Local design review only. This cookie affects fixtures, never Supabase authorization. */
export function GET(request: Request) {
  if (process.env.NODE_ENV !== 'development') return new Response('Not found', { status: 404 });
  const response = NextResponse.redirect(new URL('/dev/mock/home', request.url));
  response.cookies.set('mock_viewer', '1', { httpOnly: true, sameSite: 'strict', path: '/', maxAge: 3600 });
  return response;
}
