'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cx } from '@/components/ui';

const LINKS = [
  { href: '/missions', label: 'Missions' },
  { href: '/agents', label: 'Agents' },
  { href: '/connect', label: 'Connect' },
];

export function NavLinks() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-0.5 text-[13px] sm:text-sm" aria-label="Primary">
      {LINKS.map((link) => {
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={active ? 'page' : undefined}
            className={cx(
              'rounded-full px-2.5 py-1.5 transition-colors sm:px-3',
              active ? 'bg-white/[0.07] text-text' : 'text-muted hover:text-text',
            )}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
