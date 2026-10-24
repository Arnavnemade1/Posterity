import { Suspense, ViewTransition } from 'react';

/**
 * A page settles in. Going deeper (a link tagged `transitionTypes={['nav-forward']}`) it rises a few pixels,
 * going back or anywhere else it only crossfades; the rail and the browser chrome never move. React
 * runs these through the browser's View Transitions, so without support the page just swaps.
 */
export function PageTransition({ children }: { children: React.ReactNode }) {
  return (
    <ViewTransition
      enter={{ 'nav-forward': 'page-forward', 'nav-back': 'page-back', default: 'page-fade' }}
      exit={{ 'nav-forward': 'page-forward', 'nav-back': 'page-back', default: 'page-fade' }}
      default="none"
    >
      {children}
    </ViewTransition>
  );
}

/**
 * Content that streams in behind a skeleton: the skeleton fades out and the content rises into its place,
 * instead of the one snapping to the other. Put the data fetch inside `children` (an async component).
 */
export function Reveal({ fallback, children }: { fallback: React.ReactNode; children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <ViewTransition exit="reveal-out" default="none">
          {fallback}
        </ViewTransition>
      }
    >
      <ViewTransition enter="reveal-in" default="none">
        {children}
      </ViewTransition>
    </Suspense>
  );
}
