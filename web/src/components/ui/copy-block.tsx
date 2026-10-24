'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { cx } from '@/components/ui';

/**
 * Text you are meant to copy: a command, a config, the sentence you paste to an agent. One copy button, a clear
 * confirmation, and a manual fallback when the clipboard is blocked. `variant="prompt"` sets it as a sentence
 * rather than as code.
 */
export function CopyBlock({
  code,
  label,
  variant = 'code',
  className,
}: {
  code: string;
  /** A small heading above the text. */
  label?: string;
  variant?: 'code' | 'prompt';
  className?: string;
}) {
  const [state, setState] = useState<'idle' | 'copied' | 'error'>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const copy = async () => {
    if (timer.current) clearTimeout(timer.current);
    try {
      await navigator.clipboard.writeText(code);
      setState('copied');
    } catch {
      setState('error');
    }
    timer.current = setTimeout(() => setState('idle'), 2000);
  };

  const button = (
    <button
      type="button"
      onClick={copy}
      aria-label={state === 'copied' ? 'Copied' : label ? `Copy: ${label}` : 'Copy'}
      className={cx(
        'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-13 font-medium transition-colors duration-100',
        state === 'copied' ? 'bg-done/12 text-done' : 'bg-hover text-muted hover:bg-active hover:text-text',
      )}
    >
      {state === 'copied' ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
      {state === 'copied' ? 'Copied' : 'Copy'}
    </button>
  );
  const status = (
    <p role="status" className={state === 'error' ? 'px-4 pb-3 text-12 text-danger' : 'sr-only'}>
      {state === 'copied' ? 'Copied to the clipboard.' : state === 'error' ? 'Could not copy. Select the text above and copy it.' : ''}
    </p>
  );

  // Code keeps its own lines and gets the full width; the button sits in the header beside the label.
  if (variant === 'code') {
    return (
      <div className={cx('rounded-2xl bg-panel ring-1 ring-inset ring-line', className)}>
        <div className="flex h-11 items-center justify-between gap-3 pl-4 pr-2">
          <p className="min-w-0 truncate text-12 font-medium text-faint">{label ?? 'Code'}</p>
          {button}
        </div>
        <pre tabIndex={0} className="select-all overflow-x-auto whitespace-pre-wrap break-words px-4 pb-4 font-mono text-13 leading-[1.65] text-text">
          <code>{code}</code>
        </pre>
        {status}
      </div>
    );
  }

  return (
    <div className={cx('rounded-2xl bg-panel ring-1 ring-inset ring-line', className)}>
      {label && <p className="px-4 pt-3 text-12 font-medium text-faint">{label}</p>}
      <div className={cx('flex items-start gap-3 px-4', label ? 'pb-3 pt-2' : 'py-3')}>
        <p className="min-w-0 flex-1 select-all break-words text-15 leading-relaxed text-text">{code}</p>
        {button}
      </div>
      {status}
    </div>
  );
}
