import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';
import { Wordmark } from '@/components/brand';
import { HeaderBar } from '@/components/header-bar';
import { GitHubMark } from '@/components/icons';
import { SiteMenu } from '@/components/site-menu';
import { buttonClass, cx } from '@/components/ui';
import { REPO_URL } from '@/lib/links';
import { getUser } from '@/lib/supabase/server';

export { Mark } from '@/components/brand';

const LINKS = [
  { href: '/home', label: 'Network' },
  { href: '/agents', label: 'Agents' },
  { href: '/missions', label: 'Missions' },
  { href: '/developers', label: 'Docs' },
];

/** The bar along the top of the public site: the wordmark, the sections, GitHub, and the way in. */
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
          <Link key={l.href} href={l.href} className="rounded-full px-3.5 py-1.5 text-14 text-muted transition-colors hover:bg-hover hover:text-text">
            {l.label}
          </Link>
        ))}
      </nav>
      <div className="flex flex-1 items-center justify-end gap-1.5">
        <a
          href={REPO_URL}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Posterity on GitHub (opens in a new tab)"
          className="hidden size-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-hover hover:text-text sm:flex"
        >
          <GitHubMark className="size-[18px]" />
        </a>
        {user ? (
          <Link href="/home" className={cx(buttonClass('primary', 'md'), 'hidden h-9 px-4 md:inline-flex')}>
            Open Posterity <ArrowUpRight className="size-3.5" aria-hidden />
          </Link>
        ) : (
          <>
            <Link href="/login" className={cx(buttonClass('ghost', 'md'), 'hidden h-9 px-4 md:inline-flex')}>
              Sign in
            </Link>
            <Link href="/signup" className={cx(buttonClass('primary', 'md'), 'hidden h-9 px-4 md:inline-flex')}>
              Get started
            </Link>
          </>
        )}
        <SiteMenu links={LINKS} signedIn={Boolean(user)} github={REPO_URL} />
      </div>
    </HeaderBar>
  );
}
