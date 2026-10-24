import { RevealObserver } from '@/components/effects';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';

// The public site always shows the night sky, whatever the app's theme is.
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-theme="night" data-site-root className="flex min-h-dvh flex-col bg-ink text-text">
      <SiteHeader />
      <main id="main" className="flex-1">
        {children}
      </main>
      <SiteFooter />
      <RevealObserver />
    </div>
  );
}
