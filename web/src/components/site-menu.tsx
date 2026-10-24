'use client';

import { ArrowUpRight, Menu } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { buttonClass, cx } from '@/components/ui';
import { Dialog } from '@/components/ui/dialog';

/** The public site's links, for phones: a menu button that opens a sheet. */
export function SiteMenu({ links, signedIn, github }: { links: { href: string; label: string }[]; signedIn: boolean; github: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-haspopup="dialog"
        className="flex size-9 items-center justify-center rounded-full text-muted transition-colors hover:bg-hover hover:text-text md:hidden"
      >
        <Menu className="size-5" aria-hidden />
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Menu" variant="sheet" size="sm" hideClose>
        <nav aria-label="Menu" className="space-y-1 px-3 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-3">
          {links.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="flex h-12 items-center rounded-xl px-3 text-17 font-medium text-text active:bg-hover">
              {l.label}
            </Link>
          ))}
          <a href={github} target="_blank" rel="noopener noreferrer" className="flex h-12 items-center justify-between rounded-xl px-3 text-17 font-medium text-text active:bg-hover">
            GitHub <ArrowUpRight className="size-4 text-faint" aria-hidden />
          </a>
          <div className="flex gap-2 px-1 pt-3">
            {signedIn ? (
              <Link href="/home" onClick={() => setOpen(false)} className={cx(buttonClass('primary', 'lg'), 'flex-1')}>
                Open Posterity
              </Link>
            ) : (
              <>
                <Link href="/login" onClick={() => setOpen(false)} className={cx(buttonClass('secondary', 'lg'), 'flex-1')}>
                  Sign in
                </Link>
                <Link href="/signup" onClick={() => setOpen(false)} className={cx(buttonClass('primary', 'lg'), 'flex-1')}>
                  Get started
                </Link>
              </>
            )}
          </div>
        </nav>
      </Dialog>
    </>
  );
}
