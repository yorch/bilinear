import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import { ThemeProvider } from 'next-themes';
import { ServiceWorkerRegistrar } from '@/components/pwa/service-worker-registrar';
import { getServerAccent } from '@/lib/accent-server';
import { getServerCollabConfig } from '@/lib/collab-server';
import { getServerTranslations } from '@/lib/i18n/server';
import { PWA_BACKGROUND_DARK, PWA_BACKGROUND_LIGHT } from '@/lib/pwa';
import { Toaster } from '@/lib/toast';
import { AccentProvider } from '@/providers/accent-provider';
import { BrandingProvider } from '@/providers/branding-provider';
import { CollabProvider } from '@/providers/collab-provider';
import { LocaleProvider } from '@/providers/locale-provider';
import { getAppName } from '@/server/lib/branding';
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

/**
 * The installed app's title bar follows the system theme rather than the
 * manifest's single `theme_color`, which is why both values are declared here
 * as well. `viewport` is a static export: it can't read the theme (that lives
 * in a class on `<html>`, resolved client-side by next-themes), so the media
 * query is what does the choosing.
 */
export const viewport: Viewport = {
  themeColor: [
    { color: PWA_BACKGROUND_LIGHT, media: '(prefers-color-scheme: light)' },
    { color: PWA_BACKGROUND_DARK, media: '(prefers-color-scheme: dark)' },
  ],
};

export async function generateMetadata(): Promise<Metadata> {
  const [{ t }, appName] = await Promise.all([getServerTranslations(), getAppName()]);
  return {
    // `manifest` is injected automatically from src/app/manifest.ts.
    appleWebApp: {
      capable: true,
      statusBarStyle: 'default',
      title: appName,
    },
    applicationName: appName,
    description: t('meta.description'),
    icons: {
      // iOS has no maskable-icon concept and composites transparency onto
      // black, so it gets its own full-bleed icon.
      apple: '/icons/apple-touch-icon-180.png',
    },
    title: appName,
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [{ locale: initialLocale }, initialAccent, appName] = await Promise.all([
    getServerTranslations(),
    getServerAccent(),
    getAppName(),
  ]);
  // Read from the environment at request time (no I/O), so collab can be
  // enabled or repointed by restarting the container rather than rebuilding.
  const collabConfig = getServerCollabConfig();

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
              <BrandingProvider appName={appName}>
                <CollabProvider config={collabConfig}>
                  {children}
                  <ServiceWorkerRegistrar />
                  <Toaster closeButton position="bottom-right" richColors />
                </CollabProvider>
              </BrandingProvider>
            </LocaleProvider>
          </AccentProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
