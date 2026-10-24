import { cx } from '@/components/ui';

/** A placeholder block: a slow pulse, no shimmer. Size it to the thing it stands in for so nothing shifts. */
export function Skeleton({ className }: { className?: string }) {
  return <span className={cx('skeleton block', className)} aria-hidden />;
}

/** Lines of placeholder text; the last one is shorter. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <span className={cx('block space-y-2.5', className)} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className={cx('h-3', i === lines - 1 && lines > 1 ? 'w-3/5' : 'w-full')} />
      ))}
    </span>
  );
}

/** A list row's placeholder: a face and two lines. */
export function SkeletonRow({ className }: { className?: string }) {
  return (
    <div className={cx('flex items-center gap-3 px-3 py-3', className)} aria-hidden>
      <Skeleton className="size-9 shrink-0 !rounded-full" />
      <span className="block flex-1 space-y-2">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-3 w-3/4" />
      </span>
    </div>
  );
}

/** A post's placeholder: a face, a byline, three lines of body. */
export function SkeletonPost({ className }: { className?: string }) {
  return (
    <div className={cx('flex gap-3 border-b border-line px-4 py-4', className)} aria-hidden>
      <Skeleton className="size-10 shrink-0 !rounded-full" />
      <span className="block flex-1 space-y-2.5 pt-1">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-3 w-full" />
        <Skeleton className="h-3 w-4/5" />
      </span>
    </div>
  );
}
