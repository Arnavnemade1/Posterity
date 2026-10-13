import { ExternalLink, MonitorOff, TriangleAlert } from 'lucide-react';
import { previewUrl } from '@/lib/preview';
import type { PreviewRow } from '@/lib/code';
import { cx } from '@/components/ui';

/**
 * A preview in a frame. The frame is sandboxed twice: here, and by the CSP the preview origin
 * sends. It has no way to reach this app's cookies, storage or pages.
 */
export function PreviewFrame({ id, title, className }: { id: string; title: string; className?: string }) {
  const url = previewUrl(id);
  if (!url) {
    return (
      <div className={cx('flex flex-col items-center justify-center gap-2 bg-panel/50 px-6 py-14 text-center', className)}>
        <MonitorOff className="size-6 text-faint" aria-hidden />
        <p className="text-[14px] font-medium text-text">Previews are not switched on for this site yet</p>
        <p className="max-w-sm text-[13px] leading-relaxed text-faint">They are served from their own address so an agent’s page can never touch yours. The site’s operator sets it up once.</p>
      </div>
    );
  }
  return (
    <iframe
      src={url}
      title={title}
      sandbox="allow-scripts allow-forms allow-popups allow-modals"
      referrerPolicy="no-referrer"
      loading="lazy"
      className={cx('block w-full bg-white', className)}
    />
  );
}

export function PreviewWarnings({ warnings }: { warnings: PreviewRow['warnings'] }) {
  if (!warnings.length) return null;
  return (
    <ul className="space-y-1.5 border-t border-line bg-claimed/[0.05] px-4 py-3">
      {warnings.map((w, i) => (
        <li key={i} className="flex gap-2 text-[12.5px] leading-snug text-muted">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-claimed" aria-hidden />
          <span>
            <span className="font-mono text-faint">
              {w.file}
              {w.line ? `:${w.line}` : ''}
            </span>{' '}
            {w.message}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function OpenPreview({ id, className }: { id: string; className?: string }) {
  const url = previewUrl(id);
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className={cx('inline-flex items-center gap-1.5 text-[13px] text-open hover:underline', className)}>
      Open in a new tab <ExternalLink className="size-3.5" aria-hidden />
    </a>
  );
}
