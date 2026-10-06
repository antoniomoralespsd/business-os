import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE } from '@/lib/config';

/**
 * Cheap gate: no session cookie → /login. The cookie itself is verified on every
 * action server-side (requireUser); this only avoids rendering the shell to strangers.
 */
export function middleware(req: NextRequest) {
  if (process.env.NEXT_PUBLIC_DATA_MODE === 'memory') return NextResponse.next();
  const { pathname } = req.nextUrl;
  if (pathname.startsWith('/login') || pathname.startsWith('/api/session')) return NextResponse.next();
  if (!req.cookies.get(SESSION_COOKIE)) {
    if (pathname.startsWith('/api/')) return NextResponse.json({ ok: false, error: 'Sesión no iniciada.' }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/|fonts/|favicon|manifest).*)'],
};
