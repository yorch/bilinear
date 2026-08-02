import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { ThemeProvider } from 'next-themes';
import { getServerAccent } from '@/lib/accent-server';
import { APP_NAME } from '@/lib/app-config';
import { getServerTranslations } from '@/lib/i18n/server';
import { Toaster } from '@/lib/toast';
import { AccentProvider } from '@/providers/accent-provider';
import { LocaleProvider } from '@/providers/locale-provider';
import './globals.css';

/**
 * Typefaces are vendored (src/app/fonts, both OFL — licences alongside) and
 * loaded through `next/font/local` rather than `next/font/google` so the build
 * never depends on network access to fonts.gstatic.com.
 *
 * Both are the `latin` variable subsets, which cover every character the app's
 * two locales (en, es) need. Anything outside that range falls through to the
 * `fallback` stack, which `next/font` also uses to compute size-adjust metrics
 * so the swap doesn't shift layout.
 */
const instrumentSans = localFont({
  display: 'swap',
  fallback: ['ui-sans-serif', 'system-ui', 'sans-serif'],
  src: './fonts/InstrumentSans-Variable-latin.woff2',
  variable: '--font-instrument-sans',
  weight: '400 700',
});

const geistMono = localFont({
  display: 'swap',
  fallback: ['ui-monospace', 'monospace'],
  src: './fonts/GeistMono-Variable-latin.woff2',
  variable: '--font-geist-mono',
  weight: '400 600',
});

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await getServerTranslations();
  return {
    description: t('meta.description'),
    title: APP_NAME,
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [{ locale: initialLocale }, initialAccent] = await Promise.all([
    getServerTranslations(),
    getServerAccent(),
  ]);

  return (
    // `data-accent` is resolved from the cookie server-side so the accent is
    // already correct on first paint — no flash, and no blocking inline script
    // of the kind next-themes needs for the light/dark class.
    <html
      className={`h-full antialiased ${instrumentSans.variable} ${geistMono.variable}`}
      data-accent={initialAccent}
      lang={initialLocale}
      suppressHydrationWarning
    >
      <body className="h-full">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          disableTransitionOnChange
          enableSystem
        >
          <AccentProvider initialAccent={initialAccent}>
            <LocaleProvider initialLocale={initialLocale}>
              {children}
              <Toaster closeButton position="bottom-right" richColors />
            </LocaleProvider>
          </AccentProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
