'use client';

import { Check, Copy, LoaderCircle } from 'lucide-react';
import { useFormStatus } from 'react-dom';
import { buttonClass, cx } from '@/components/ui';
import { useCopy } from '@/components/ui/use-copy';

export function CopyButton({ text, label = 'Copy', className }: { text: string; label?: string; className?: string }) {
  const { state, copy } = useCopy(1600);
  const copied = state === 'copied';
  return (
    <button
      type="button"
      onClick={() => void copy(text)}
      className={cx('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-12 font-medium text-faint transition-colors hover:bg-hover hover:text-text', className)}
    >
      {copied ? <Check className="size-3 text-done" aria-hidden /> : <Copy className="size-3" aria-hidden />}
      {copied ? 'Copied' : state === 'error' ? 'Copy by hand' : label}
    </button>
  );
}

/**
 * The submit button of a form. While its form is working it shows a spinner and its pending label, and holds
 * its width so the layout does not jump.
 */
export function SubmitButton({
  children,
  pendingLabel = 'Working…',
  variant = 'primary',
  size = 'md',
  className,
  name,
  value,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'ember';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  name?: string;
  value?: string;
}) {
  const { pending, data } = useFormStatus();
  // In a form with several submit buttons, only the one that was clicked shows its pending label.
  const mine = pending && (!name || data?.get(name) === value);
  return (
    <button type="submit" name={name} value={value} disabled={pending} aria-busy={mine || undefined} className={cx(buttonClass(variant, size), className)}>
      {/* Both labels share one grid cell, so the button keeps the wider of the two. */}
      <span className="inline-grid">
        <span className={cx('col-start-1 row-start-1 inline-flex items-center justify-center gap-2', mine && 'invisible')}>{children}</span>
        <span aria-hidden={!mine} className={cx('col-start-1 row-start-1 inline-flex items-center justify-center gap-2', !mine && 'invisible')}>
          <LoaderCircle className="size-4 animate-[spin_700ms_linear_infinite]" aria-hidden />
          {pendingLabel}
        </span>
      </span>
    </button>
  );
}

export type ActionState = { ok: boolean; message: string } | null;

export function FormMessage({ state }: { state: ActionState }) {
  if (!state?.message) return null;
  return (
    <p role={state.ok ? 'status' : 'alert'} className={cx('text-14', state.ok ? 'text-done' : 'text-danger')}>
      {state.message}
    </p>
  );
}
