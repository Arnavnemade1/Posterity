import { ViewTransition } from 'react';
import { Skeleton, SkeletonRow } from '@/components/ui/skeleton';

/**
 * Skeletons shaped like the layouts they stand in for, so a page does not jump when its content arrives.
 * Each one mirrors a frame from components/shell/column.tsx and hands over to the page with a fade.
 */
function Handover({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition exit="reveal-out" default="none">
      <div className="flex w-full min-w-0 justify-center gap-6 min-[1100px]:px-4" aria-busy="true" aria-label="Loading">
        {children}
      </div>
    </ViewTransition>
  );
}

function Header({ tabs = false }: { tabs?: boolean }) {
  return (
    <div className="border-b border-line">
      <div className="flex min-h-[var(--column-header-h)] items-center px-4">
        <Skeleton className="h-5 w-32" />
      </div>
      {tabs && (
        <div className="flex h-[var(--column-tabs-h)] items-center justify-around px-4">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-4 w-16" />
          ))}
        </div>
      )}
    </div>
  );
}

function RailSkeletons() {
  return (
    <div className="hidden w-[300px] shrink-0 space-y-6 py-4 min-[1100px]:block">
      <Skeleton className="h-11 w-full !rounded-full" />
      <Skeleton className="h-48 w-full !rounded-2xl" />
      <Skeleton className="h-36 w-full !rounded-2xl" />
    </div>
  );
}

/** A column of posts with the rail beside it: Home, Explore, a thread, bookmarks. */
export function FeedLoading() {
  return (
    <Handover>
      <div className="min-h-dvh w-full max-w-[640px] border-line sm:border-x">
        <Header tabs />
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex gap-3 border-b border-line px-4 py-4">
            <Skeleton className="size-10 shrink-0 !rounded-full" />
            <span className="block flex-1 space-y-2.5 pt-1">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-4/5" />
            </span>
          </div>
        ))}
      </div>
      <RailSkeletons />
    </Handover>
  );
}

/** A list of things with a search bar over it: missions, agents, workspaces, the exchange. */
export function ListLoading() {
  return (
    <Handover>
      <div className="min-h-dvh w-full max-w-[640px] border-line sm:border-x">
        <Header />
        <div className="space-y-3 px-4 py-4">
          <Skeleton className="h-10 w-full !rounded-full" />
          <div className="flex gap-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-8 w-20 !rounded-full" />
            ))}
          </div>
        </div>
        <div className="space-y-1 px-2">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <SkeletonRow key={i} className="min-h-[72px]" />
          ))}
        </div>
      </div>
      <RailSkeletons />
    </Handover>
  );
}

/** One thing in full: a mission, a task, a profile. A title, a strip of facts, then the body. */
export function DetailLoading({ rail = false }: { rail?: boolean }) {
  return (
    <Handover>
      <div className={`min-h-dvh w-full ${rail ? 'max-w-[640px] border-line sm:border-x' : 'mx-auto max-w-[1200px]'}`}>
        <Header />
        <div className="space-y-5 px-4 py-6 sm:px-5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-8 w-3/4" />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 !rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-56 w-full !rounded-2xl" />
          <Skeleton className="h-32 w-full !rounded-2xl" />
        </div>
      </div>
      {rail && <RailSkeletons />}
    </Handover>
  );
}

/** A list at the left and one thing open at the right: messages, and later the code browser. */
export function SplitLoading() {
  return (
    <Handover>
      <div className="flex h-[calc(100dvh-7rem)] w-full sm:h-dvh">
        <div className="w-full shrink-0 border-line sm:w-[340px] sm:border-r">
          <Header />
          <div className="space-y-1 px-2 py-2">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <SkeletonRow key={i} />
            ))}
          </div>
        </div>
        <div className="hidden flex-1 sm:block">
          <Header />
        </div>
      </div>
    </Handover>
  );
}
