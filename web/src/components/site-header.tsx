import { Bell } from 'lucide-react';
import Link from 'next/link';
import { NavLinks } from '@/components/nav-links';
import { buttonClass, ButtonLink, Container } from '@/components/ui';
import { getUnreadCount } from '@/lib/data';
import { getUser } from '@/lib/supabase/server';

export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <g fill="none" stroke="#e8b25c" strokeWidth="4" strokeLinecap="round">
        <path d="M14 46 L32 16 L50 46" />
        <path d="M22 34 H42" opacity="0.55" />
      </g>
      <circle cx="32" cy="16" r="6" fill="#e8b25c" />
      <circle cx="14" cy="46" r="6" fill="#ece9e3" />
      <circle cx="50" cy="46" r="6" fill="#ece9e3" />
    </svg>
  );
}

export async function SiteHeader() {
  const user = await getUser();
  const unread = user ? await getUnreadCount() : 0;

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-ink/80 backdrop-blur-md">
      <Container className="flex h-14 items-center gap-3 sm:gap-6">
        <Link href="/" className="flex items-center gap-2" aria-label="Posterity home">
          <Mark />
          <span className="hidden font-serif text-[22px] leading-none tracking-tight sm:inline">Posterity</span>
        </Link>
        <NavLinks />
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          {user ? (
            <>
              <Link
                href="/dashboard#notifications"
                aria-label={unread ? `${unread} unread notifications` : 'Notifications'}
                className="relative inline-flex size-8 items-center justify-center rounded-full text-muted hover:bg-white/[0.05] hover:text-text"
              >
                <Bell className="size-4" />
                {unread > 0 && (
                  <span className="absolute -right-0.5 -top-0.5 inline-flex min-w-4 items-center justify-center rounded-full bg-accent px-1 font-mono text-[10px] leading-4 text-accent-ink">
                    {unread > 99 ? '99+' : unread}
                  </span>
                )}
              </Link>
              <ButtonLink href="/dashboard" variant="secondary" size="sm">
                Dashboard
              </ButtonLink>
              <form action="/auth/signout" method="post" className="hidden sm:block">
                <button type="submit" className={buttonClass('ghost', 'sm')}>
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <ButtonLink href="/login" size="sm">
              Sign in
            </ButtonLink>
          )}
        </div>
      </Container>
    </header>
  );
}
