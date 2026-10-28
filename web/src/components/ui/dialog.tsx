'use client';

import { X } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { buttonClass, cx } from '@/components/ui';

const WIDTH = { sm: 380, md: 480, lg: 640, xl: 840 } as const;
let scrollLocks = 0;
let previousOverflow = '';

/**
 * A modal dialog on the native `<dialog>`: the browser traps focus, closes on Escape and makes the page behind
 * inert. It fades and settles in and out (CSS, in globals.css). `sheet` rises from the bottom edge on phones;
 * `palette` sits high on the screen for command bars.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  size = 'md',
  variant,
  hideClose = false,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  /** Names the dialog for screen readers; shown as a heading unless `variant` is 'palette'. */
  title: string;
  description?: React.ReactNode;
  size?: keyof typeof WIDTH;
  variant?: 'sheet' | 'palette';
  hideClose?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    if (scrollLocks++ === 0) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    return () => {
      if (--scrollLocks === 0) document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      data-variant={variant}
      style={{ ['--dialog-w' as string]: `${WIDTH[size]}px` }}
      className="dialog"
      onClick={(e) => e.stopPropagation()}
      // Escape: let the page own the state, so the dialog and `open` never disagree.
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // The backdrop is the dialog element itself; the panel inside fills it.
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      onClose={() => open && onClose()}
    >
      <div className={cx('flex max-h-[inherit] flex-col', className)}>
        {variant === 'palette' ? (
          <h2 id={titleId} className="sr-only">
            {title}
          </h2>
        ) : (
          <header className="flex shrink-0 items-start gap-3 px-5 pb-1 pt-5">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-18 font-semibold tracking-[-0.015em] text-text">
                {title}
              </h2>
              {description && <p className="mt-1 text-14 leading-relaxed text-muted">{description}</p>}
            </div>
            {!hideClose && (
              <button type="button" onClick={onClose} aria-label="Close" className="-mr-1.5 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-full text-faint transition-colors hover:bg-hover hover:text-text">
                <X className="size-[18px]" aria-hidden />
              </button>
            )}
          </header>
        )}
        {children}
      </div>
    </dialog>
  );
}

/** The foot of a dialog: its actions, aligned to the right. */
export function DialogActions({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx('flex flex-wrap justify-end gap-2 px-5 pb-5 pt-4', className)}>{children}</div>;
}

export interface ConfirmOptions {
  title: string;
  description?: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 'danger' for things that cannot be undone. */
  tone?: 'default' | 'danger';
}

/**
 * Ask before doing something that matters, in place of `window.confirm`:
 *   const { confirm, dialog } = useConfirm();
 *   if (await confirm({ title: 'Delete this post?', tone: 'danger', confirmLabel: 'Delete' })) …
 * Render `{dialog}` once in the component.
 */
export function useConfirm() {
  const [ask, setAsk] = useState<ConfirmOptions | null>(null);
  const [open, setOpen] = useState(false);
  const resolveAnswer = useRef<((ok: boolean) => void) | null>(null);
  useEffect(() => () => {
    resolveAnswer.current?.(false);
    resolveAnswer.current = null;
  }, []);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        resolveAnswer.current?.(false);
        resolveAnswer.current = resolve;
        setAsk(options);
        setOpen(true);
      }),
    [],
  );
  const answer = (ok: boolean) => {
    resolveAnswer.current?.(ok);
    resolveAnswer.current = null;
    setOpen(false);
  };

  const dialog = (
    <Dialog open={open} onClose={() => answer(false)} title={ask?.title ?? ''} description={ask?.description} size="sm" hideClose>
      <DialogActions>
        <button type="button" onClick={() => answer(false)} className={buttonClass('ghost', 'md')}>
          {ask?.cancelLabel ?? 'Cancel'}
        </button>
        <button type="button" onClick={() => answer(true)} className={buttonClass(ask?.tone === 'danger' ? 'danger' : 'primary', 'md')}>
          {ask?.confirmLabel ?? 'Confirm'}
        </button>
      </DialogActions>
    </Dialog>
  );
  return { confirm, dialog };
}
