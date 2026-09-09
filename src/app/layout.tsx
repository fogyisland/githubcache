import { JetBrains_Mono, IBM_Plex_Sans, IBM_Plex_Mono, Fraunces, Space_Grotesk } from 'next/font/google';
import { headers } from 'next/headers';
import type { Metadata } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import './globals.css';
import { SiteHeader } from '@/app/_components/site-header';
import { readThemeFromCookieHeader } from '@/lib/theme/cookie';
import { readLangFromCookieHeader } from '@/lib/lang/cookie';
import { resolveLocale } from '@/lib/lang/registry';
import { SITE_NAME } from '@/lib/config/site';

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
  title: SITE_NAME,
  description:
    'Submit a GitHub repo, get cached metadata (stars, forks, language, license, topics, dates). Per-IP rate limit, no GitHub token required.',
  // Web Interface Guidelines: theme-color lets mobile browsers paint
  // the URL bar / chrome to match the page surface (avoids the white
  // flash on Android PWA add-to-homescreen).
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#FAFAF7' },
    { media: '(prefers-color-scheme: dark)', color: '#14141A' },
  ],
};

// Root layout — server component, reads the theme cookie via next/headers
// and writes it as data-theme on <html> so the first paint already has the
// correct tokens. No flash, no client JS needed for the initial render.
//
// Locale resolution lives here too (not in src/middleware.ts — see Task 2
// brief "Architecture decision"). Order: cookie > Accept-Language > default.
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // headers() returns the raw request headers from the incoming Request.
  // Reading the cookie header here is the only way to set data-theme
  // before paint; doing it client-side would cause a flash of default theme.
  const headerStore = await headers();
  const cookieHeader = headerStore.get('cookie') ?? null;
  const theme = readThemeFromCookieHeader(cookieHeader);
  const locale = resolveLocale({
    cookieValue: readLangFromCookieHeader(cookieHeader),
    acceptLanguage: headerStore.get('accept-language'),
  });

  // Pre-load messages for the resolved locale — NextIntlClientProvider needs
  // the full bundle (it's passed via prop, not auto-resolved).
  const messages = (await import(`../../messages/${locale}.json`)).default;

  return (
    <html
      lang={locale}
      data-theme={theme}
      className={`${jetbrainsMono.variable} ${fraunces.variable} ${plexSans.variable} ${plexMono.variable} ${spaceGrotesk.variable}`}
    >
      <body className="min-h-screen font-sans antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <SiteHeader />
          {children}
        </NextIntlClientProvider>
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
