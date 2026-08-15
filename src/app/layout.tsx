import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'GitHub Metadata Cache',
  description: 'A managed GitHub metadata cache with a public query API.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
