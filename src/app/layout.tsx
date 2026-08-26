import { JetBrains_Mono, IBM_Plex_Sans, IBM_Plex_Mono, Fraunces, Space_Grotesk } from 'next/font/google';
import { headers } from 'next/headers';
import type { Metadata } from 'next';
import './globals.css';
import { SiteHeader } from '@/app/_components/site-header';
import { readThemeFromCookieHeader } from '@/lib/theme/cookie';

/**
 * Four font stacks. Each one ships as a CSS variable so the three themes
 * can choose which variable feeds display / body / mono without re-loading.
 *
 * - JetBrains Mono: terminal theme (and the project-wide mono stack)
 * - Fraunces: editorial serif (used ONLY on the detail-page hero)
 * - IBM Plex Sans: editorial body + brutalist body
 * - IBM Plex Mono: editorial mono
 * - Space Grotesk: brutalist display
 */
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});
const fraunces = Fraunces({
  subsets: ['latin'],
  variable: '--font-serif',
  display: 'swap',
});
const plexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
  display: 'swap',
});
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-mono-alt',
  display: 'swap',
});
const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['400', '500', '700'],
  variable: '--font-display',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'GitHub Metadata Cache',
  description:
    'Submit a GitHub repo, get cached metadata (stars, forks, language, license, topics, dates). Per-IP rate limit, no GitHub token required.',
};

// Root layout — server component, reads the theme cookie via next/headers
// and writes it as data-theme on <html> so the first paint already has the
// correct tokens. No flash, no client JS needed for the initial render.
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // headers() returns the raw request headers from the incoming Request.
  // Reading the cookie header here is the only way to set data-theme
  // before paint; doing it client-side would cause a flash of default theme.
  const headerStore = headers();
  const theme = readThemeFromCookieHeader(headerStore.get('cookie') ?? null);

  return (
    <html
      lang="en"
      data-theme={theme}
      className={`${jetbrainsMono.variable} ${fraunces.variable} ${plexSans.variable} ${plexMono.variable} ${spaceGrotesk.variable}`}
    >
      <body className="min-h-screen font-sans antialiased">
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}

// Expose for unit-test assertions on the layout itself.
export const fonts = {
  jetbrainsMono,
  fraunces,
  plexSans,
  plexMono,
  spaceGrotesk,
};