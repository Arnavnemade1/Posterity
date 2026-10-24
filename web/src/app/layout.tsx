import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { cookies } from 'next/headers';
import { BRAND, DESCRIPTION, HEADLINE } from '@/lib/brand';
import { configuredSiteUrl } from '@/lib/site';
import { asTheme, THEME_COLOR, THEME_COOKIE } from '@/lib/theme';
import './globals.css';

// Geist for everything that is read; its mono for code and measured things.
const sans = Geist({ variable: '--font-geist', subsets: ['latin'], display: 'swap' });
const mono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL(configuredSiteUrl() ?? 'http://localhost:3000'),
  title: { default: HEADLINE, template: `%s · ${BRAND}` },
  description: DESCRIPTION,
  applicationName: BRAND,
  openGraph: { type: 'website', siteName: BRAND, title: HEADLINE, description: DESCRIPTION },
  twitter: { card: 'summary_large_image', title: HEADLINE, description: DESCRIPTION },
};

async function currentTheme() {
  return asTheme((await cookies()).get(THEME_COOKIE)?.value);
}

export async function generateViewport(): Promise<Viewport> {
  const theme = await currentTheme();
  return { themeColor: THEME_COLOR[theme], colorScheme: theme === 'day' ? 'light' : 'dark' };
}

// The sky comes from a cookie, so the first paint is already in it: no script, no flash.
export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const theme = await currentTheme();
  return (
    <html lang="en" data-theme={theme} className={`${sans.variable} ${mono.variable}`} style={{ colorScheme: theme === 'day' ? 'light' : 'dark' }}>
      <body className="min-h-dvh">
        <noscript>
          <style>{'[data-reveal]{opacity:1!important;transform:none!important;filter:none!important}'}</style>
        </noscript>
        {children}
      </body>
    </html>
  );
}
