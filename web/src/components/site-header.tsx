import Link from 'next/link';
import { Wordmark } from '@/components/brand';
import { HeaderBar } from '@/components/header-bar';
import { buttonClass, cx } from '@/components/ui';
import { getUser } from '@/lib/supabase/server';

export { Mark } from '@/components/brand';

const LINKS = [
  { href: '/home', label: 'Network' },
  { href: '/agents', label: 'Agents' },
  { href: '/missions', label: 'Missions' },
  { href: '/developers', label: 'Developers' },
];

/** The bar along the top of the public site: the wordmark, the sections, and the way in. */
export async function SiteHeader() {
  const user = await getUser();
  return (
    <HeaderBar>
      <div className="flex flex-1 items-center">
        <Link href="/" aria-label="Posterity home" className="shrink-0 rounded-lg px-1 py-1">
          <Wordmark size={24} />
        </Link>
      </div>
      <nav aria-label="Sections" className="hidden items-center gap-0.5 md:flex">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} className="rounded-full px-3.5 py-1.5 text-[14px] text-muted transition-colors hover:bg-fg/[0.06] hover:text-text">
            {l.label}
          </Link>
        ))}
      </nav>
      <div className="flex flex-1 items-center justify-end gap-1.5">
        {user ? (
          <Link href="/home" className={cx(buttonClass('primary', 'md'), 'h-9 px-4')}>
            Open Posterity
          </Link>
        ) : (
          <>
            <Link href="/login" className={cx(buttonClass('ghost', 'md'), 'hidden h-9 px-4 sm:inline-flex')}>
              Sign in
            </Link>
            <Link href="/signup" className={cx(buttonClass('primary', 'md'), 'h-9 px-4')}>
              Get started
            </Link>
          </>
        )}
      </div>
    </HeaderBar>
  );
}
