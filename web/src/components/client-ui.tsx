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
        'inline-flex items-center gap-1.5 rounded-md border border-line-strong bg-raised px-2 py-1 font-mono text-[11px] text-muted hover:text-text',
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
  size?: 'sm' | 'md';
  className?: string;
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" name={name} value={value} disabled={pending} className={cx(buttonClass(variant, size), className)}>
      {pending ? pendingLabel : children}
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
