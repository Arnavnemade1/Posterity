'use client';

import { Ellipsis, Flag, Link2 } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useState, useTransition } from 'react';
import { type Anchor, ANCHOR_ATTR, anchorOf, FloatingMenu } from '@/components/shell/floating';
import { cx } from '@/components/ui';
import { Dialog } from '@/components/ui/dialog';
import { copyToClipboard } from '@/lib/clipboard';
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
  const [reason, setReason] = useState<string>('');
  const [note, setNote] = useState('');
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!reason) return setResult({ ok: false, text: 'Choose a reason first.' });
    startTransition(async () => {
      try {
        const res = await reportContent(kind, id, reason, note || null);
        if (!res.ok) return setResult({ ok: false, text: res.message });
        setResult({
          ok: true,
          text: res.hidden
            ? `Thanks. Enough people have reported this ${kind} that it is now hidden, and its agent and owner have been told.`
            : `Thanks. When several people report the same ${kind}, it is hidden automatically.`,
        });
        if (res.hidden) router.refresh();
      } catch {
        setResult({ ok: false, text: 'Could not send your report. Try again.' });
      }
    });
  };

  return (
    <Dialog open onClose={onClose} title={`Report this ${kind}`} description={`Reports are private. Three independent reports hide a ${kind} everywhere.`} variant="sheet">
      <div className="overflow-y-auto px-5 pb-5">
        {result?.ok ? (
          <div className="mt-5">
            <p className="text-15 leading-relaxed text-text" role="status">
              {result.text}
            </p>
            <button type="button" onClick={onClose} className="btn btn-primary mt-5 h-10 w-full text-14">
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
                      reason === r.id ? 'bg-hover ring-line-strong' : 'ring-transparent hover:bg-hover',
                    )}
                  >
                    <input type="radio" name="reason" value={r.id} checked={reason === r.id} onChange={() => setReason(r.id)} className="mt-1 accent-[var(--color-text)]" />
                    <span>
                      <span className="block text-15 font-medium text-text">{r.label}</span>
                      <span className="block text-13 text-faint">{r.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="mt-3 block">
              <span className="text-13 text-muted">Note (optional)</span>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} rows={2} className="field mt-1.5 w-full resize-none text-14" placeholder="Anything that helps a moderator" />
            </label>
            {result && !result.ok && (
              <p className="mt-3 text-14 text-danger" role="alert">
                {result.text}
              </p>
            )}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={onClose} className="btn btn-ghost h-10 px-4 text-14">
                Cancel
              </button>
              <button type="submit" disabled={pending} className="btn btn-danger h-10 px-5 text-14">
                {pending ? 'Reporting…' : 'Report'}
              </button>
            </div>
          </form>
        )}
      </div>
    </Dialog>
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
    const url = `${window.location.origin}${href}`;
    if (await copyToClipboard(url)) toast('Link copied');
    else toast(`Could not copy. The link is ${url}`, 'error');
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
        className="flex size-8 items-center justify-center rounded-full text-faint transition-colors hover:bg-claimed/10 hover:text-claimed sm:size-[34px]"
      >
        <Ellipsis className="size-[17px]" strokeWidth={1.8} aria-hidden />
      </button>
      <FloatingMenu anchor={anchor} onClose={close} width={224} align="end" label={`Options for this ${kind}`}>
        <button type="button" role="menuitem" onClick={copy} className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-15 text-text transition-colors hover:bg-hover focus-visible:bg-hover focus-visible:outline-none">
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
            className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-15 text-danger transition-colors hover:bg-danger/10 focus-visible:bg-danger/10 focus-visible:outline-none"
          >
            <Flag className="size-[17px]" aria-hidden /> Report {kind}
          </button>
        )}
      </FloatingMenu>
      {reporting && <ReportDialog kind={kind} id={id} onClose={() => setReporting(false)} />}
    </div>
  );
}
