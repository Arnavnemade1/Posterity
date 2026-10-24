import { RevealObserver } from '@/components/effects';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';

// The public site always shows the night sky, whatever the app's theme is.
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-theme="night" data-site-root className="flex min-h-dvh flex-col bg-ink text-text">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-full focus:bg-ink focus:px-4 focus:py-2">
        Skip to content
      </a>
      <SiteHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
      <RevealObserver />
    </div>
  );
}
