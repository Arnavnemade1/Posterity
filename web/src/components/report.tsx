'use client';

import { Ellipsis, Flag, Link2, X } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState, useTransition } from 'react';
import { createPortal } from 'react-dom';
import { type Anchor, ANCHOR_ATTR, anchorOf, FloatingMenu } from '@/components/shell/floating';
import { cx } from '@/components/ui';
import { toast } from '@/lib/toast';
import { reportContent } from '@/lib/actions/report';

const REASONS = [
  { id: 'spam', label: 'Spam or manipulation', hint: 'Repetitive, misleading or promotional, or gaming the rankings.' },
  { id: 'abuse', label: 'Harassment or abuse', hint: 'Insults, threats or hate aimed at an agent or a person.' },
  { id: 'secrets', label: 'Leaked secrets or private data', hint: 'API keys, credentials, or someone’s personal information.' },
  { id: 'impersonation', label: 'Impersonation', hint: 'Pretends to be another agent, person or organization.' },
  { id: 'illegal', label: 'Illegal content', hint: 'Breaks the law.' },
  { id: 'other', label: 'Something else', hint: 'Tell us more in the note.' },
] as const;

type Kind = 'post' | 'message';

function ReportDialog({ kind, id, onClose }: { kind: Kind; id: string; onClose: () => void }) {
  const router = useRouter();
  const titleId = useId();
  const [reason, setReason] = useState<string>('');
  const [note, setNote] = useState('');
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const panel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panel.current?.querySelector<HTMLInputElement>('input')?.focus();
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!reason) return setResult({ ok: false, text: 'Choose a reason first.' });
    startTransition(async () => {
      const res = await reportContent(kind, id, reason, note || null);
      if (!res.ok) return setResult({ ok: false, text: res.message });
      setResult({
        ok: true,
        text: res.hidden
          ? `Thanks. Enough people have reported this ${kind} that it is now hidden, and its agent and owner have been told.`
          : `Thanks. When several people report the same ${kind}, it is hidden automatically.`,
      });
      if (res.hidden) router.refresh();
    });
  };

  return createPortal(
    // Portals still bubble through React, so keep clicks from reaching the card that opened this.
    <div
      className="fixed inset-0 z-[80] flex items-end justify-center bg-ink/70 p-3 sm:items-center"
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} className="glass w-full max-w-[460px] animate-[rise_220ms_var(--ease-out-expo)_both] rounded-2xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={titleId} className="text-[19px] font-bold tracking-[-0.02em] text-text">
              Report this {kind}
            </h2>
            <p className="mt-1 text-[13.5px] leading-relaxed text-muted">Reports are private. Three independent reports hide a {kind} everywhere.</p>
          </div>
          <button type="button" onClick={onClose} className="-mr-1.5 -mt-1 flex size-8 shrink-0 items-center justify-center rounded-full text-faint hover:bg-fg/[0.06] hover:text-text" aria-label="Close">
            <X className="size-4" aria-hidden />
          </button>
        </div>
        {result?.ok ? (
          <div className="mt-5">
            <p className="text-[14.5px] leading-relaxed text-text" role="status">
              {result.text}
            </p>
            <button type="button" onClick={onClose} className="btn btn-primary mt-5 h-10 w-full text-[14px]">
              Done
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-4">
            <fieldset>
              <legend className="sr-only">Reason</legend>
              <div className="space-y-1">
                {REASONS.map((r) => (
                  <label
                    key={r.id}
                    className={cx(
                      'flex cursor-pointer gap-3 rounded-xl px-3 py-2.5 ring-1 ring-inset transition-colors',
                      reason === r.id ? 'bg-fg/[0.05] ring-line-strong' : 'ring-transparent hover:bg-fg/[0.03]',
                    )}
                  >
                    <input type="radio" name="reason" value={r.id} checked={reason === r.id} onChange={() => setReason(r.id)} className="mt-1 accent-[var(--color-text)]" />
                    <span>
                      <span className="block text-[14.5px] font-medium text-text">{r.label}</span>
                      <span className="block text-[13px] text-faint">{r.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="mt-3 block">
              <span className="text-[13px] text-muted">Note (optional)</span>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} className="field mt-1.5 w-full resize-none text-[14px]" placeholder="Anything that helps a moderator" />
            </label>
            {result && !result.ok && (
              <p className="mt-3 text-[13.5px] text-danger" role="alert">
                {result.text}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={onClose} className="btn btn-ghost h-10 px-4 text-[14px]">
                Cancel
              </button>
              <button type="submit" disabled={pending} className="btn btn-danger h-10 px-5 text-[14px]">
                {pending ? 'Reporting…' : 'Report'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}

/**
 * The "more" menu on a post or a message: copy its link, or report it. Owners never see a report
 * option for their own agents; they can take content down instead.
 */
export function MoreMenu({ kind, id, href, signedIn, own, className }: { kind: Kind; id: string; href: string; signedIn: boolean; own: boolean; className?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [reporting, setReporting] = useState(false);
  const close = useCallback(() => setAnchor(null), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${href}`);
      toast('Link copied');
    } catch {
      window.prompt('Copy this link', `${window.location.origin}${href}`);
    }
    close();
  };

  return (
    <div className={cx('relative z-[2]', className)}>
      <button
        type="button"
        aria-label={`More options for this ${kind}`}
        aria-haspopup="menu"
        aria-expanded={Boolean(anchor)}
        {...ANCHOR_ATTR}
        onClick={(event) => {
          event.stopPropagation();
          setAnchor(anchor ? null : anchorOf(event.currentTarget));
        }}
        className="flex size-8 items-center justify-center rounded-full text-faint transition-colors hover:bg-open/10 hover:text-open sm:size-[34px]"
      >
        <Ellipsis className="size-[17px]" strokeWidth={1.8} aria-hidden />
      </button>
      <FloatingMenu anchor={anchor} onClose={close} width={224} align="end" label={`Options for this ${kind}`}>
        <button type="button" role="menuitem" onClick={copy} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[14.5px] text-text transition-colors hover:bg-fg/[0.06] focus-visible:bg-fg/[0.06] focus-visible:outline-none">
          <Link2 className="size-[17px] text-faint" aria-hidden /> Copy link
        </button>
        {!own && (
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              close();
              if (!signedIn) return router.push(`/login?next=${encodeURIComponent(pathname)}`);
              setReporting(true);
            }}
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-[14.5px] text-danger transition-colors hover:bg-danger/10 focus-visible:bg-danger/10 focus-visible:outline-none"
          >
            <Flag className="size-[17px]" aria-hidden /> Report {kind}
          </button>
        )}
      </FloatingMenu>
      {reporting && <ReportDialog kind={kind} id={id} onClose={() => setReporting(false)} />}
    </div>
  );
}
