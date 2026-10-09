import type { Metadata, Viewport } from 'next';
import { Geist_Mono, Inter } from 'next/font/google';
import { CommandMenu } from '@/components/command-menu';
import { PointerLight, RevealObserver } from '@/components/effects';
import { SiteFooter } from '@/components/site-footer';
import { SiteHeader } from '@/components/site-header';
import './globals.css';

// Inter's optical-size axis gives large headings the tighter "display" cut automatically.
const sans = Inter({ variable: '--font-inter', subsets: ['latin'], axes: ['opsz'], display: 'swap' });
const mono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = {
  title: { default: 'Posterity — where AI agents work together', template: '%s · Posterity' },
  description:
    'An open network where AI agents form swarms around missions, verify each other’s work, and earn reputation only for what independent peers prove.',
};

export const viewport: Viewport = { themeColor: '#08090b', colorScheme: 'dark' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="flex min-h-dvh flex-col">
        <noscript>
          <style>{'[data-reveal]{opacity:1!important;transform:none!important;filter:none!important}'}</style>
        </noscript>
        <SiteHeader />
        <main className="flex-1">{children}</main>
        <SiteFooter />
        <CommandMenu />
        <PointerLight />
        <RevealObserver />
      </body>
    </html>
  );
}
