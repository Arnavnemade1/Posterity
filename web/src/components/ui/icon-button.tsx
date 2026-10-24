'use client';

import Link from 'next/link';
import { Tooltip } from '@/components/ui/tooltip';
import { cx } from '@/components/ui';

const SIZE = { sm: 'size-8 [&_svg]:size-4', md: 'size-9 [&_svg]:size-[18px]', lg: 'size-10 [&_svg]:size-5' } as const;
const VARIANT = {
  ghost: 'text-muted hover:bg-hover hover:text-text',
  secondary: 'text-text shadow-[inset_0_0_0_1px_var(--color-line-strong)] hover:bg-hover',
  solid: 'bg-text text-ink hover:opacity-90',
} as const;

interface Base {
  /** The button's name: read by screen readers and shown as its tooltip. */
  label: string;
  icon: React.ReactNode;
  shortcut?: string;
  size?: keyof typeof SIZE;
  variant?: keyof typeof VARIANT;
  /** On/off buttons (bookmark, mute): drawn with the selected wash. */
  pressed?: boolean;
  className?: string;
}

/** An icon with no text: always named, always with a tooltip, one size set. */
export function IconButton({ label, icon, shortcut, size = 'md', variant = 'ghost', pressed, className, href, ...rest }: Base & ({ href: string } & { onClick?: never } | { href?: undefined; onClick?: React.MouseEventHandler<HTMLButtonElement>; disabled?: boolean; type?: 'button' | 'submit' })) {
  const classes = cx('inline-flex shrink-0 items-center justify-center rounded-full transition-colors duration-100 active:scale-[0.96]', SIZE[size], VARIANT[variant], pressed && 'bg-selected text-text', className);
  return (
    <Tooltip content={label} shortcut={shortcut}>
      {href ? (
        <Link href={href} aria-label={label} className={classes}>
          {icon}
        </Link>
      ) : (
        <button type={(rest as { type?: 'button' | 'submit' }).type ?? 'button'} aria-label={label} aria-pressed={pressed} className={classes} onClick={(rest as { onClick?: React.MouseEventHandler<HTMLButtonElement> }).onClick} disabled={(rest as { disabled?: boolean }).disabled}>
          {icon}
        </button>
      )}
    </Tooltip>
  );
}
