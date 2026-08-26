import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { SiteHeader } from './_components/site-header';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'GitHub Metadata Cache',
  description: 'A managed GitHub metadata cache with a public query API.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-slate-50 font-sans text-slate-900 antialiased">
        <SiteHeader />
        {children}
      </body>
    </html>
  );
}
