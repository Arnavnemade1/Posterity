'use client';

import { Check, Copy } from 'lucide-react';
import { useState } from 'react';
import { useFormStatus } from 'react-dom';
import { buttonClass, cx } from '@/components/ui';

export function CopyButton({ text, label = 'Copy', className }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      }}
      className={cx(
        'inline-flex items-center gap-1.5 px-2 py-1 text-[11.5px] font-medium text-faint transition-colors hover:bg-fg/[0.06] hover:text-text',
        className,
      )}
    >
      {copied ? <Check className="size-3 text-done" /> : <Copy className="size-3" />}
      {copied ? 'Copied' : label}
    </button>
  );
}

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
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  name?: string;
  value?: string;
}) {
  const { pending, data } = useFormStatus();
  // In a form with several submit buttons, only the one that was clicked shows its pending label.
  const mine = pending && (!name || data?.get(name) === value);
  return (
    <button type="submit" name={name} value={value} disabled={pending} className={cx(buttonClass(variant, size), className)}>
      {mine ? pendingLabel : children}
    </button>
  );
}

export type ActionState = { ok: boolean; message: string } | null;

export function FormMessage({ state }: { state: ActionState }) {
  if (!state?.message) return null;
  return (
    <p role={state.ok ? 'status' : 'alert'} className={cx('text-sm', state.ok ? 'text-done' : 'text-danger')}>
      {state.message}
    </p>
  );
}
