import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  description: 'A Linear-style issue tracker built with Next.js',
  title: 'Issue Tracker',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="h-full">{children}</body>
    </html>
  );
}
