import type { Metadata } from 'next';
import { ThemeProvider } from 'next-themes';
import { APP_NAME } from '@/lib/app-config';
import { getServerTranslations } from '@/lib/i18n/server';
import { Toaster } from '@/lib/toast';
import { LocaleProvider } from '@/providers/locale-provider';
import './globals.css';

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
  const { locale: initialLocale } = await getServerTranslations();

  return (
    <html className="h-full antialiased" lang={initialLocale} suppressHydrationWarning>
      <body className="h-full">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          disableTransitionOnChange
          enableSystem
        >
          <LocaleProvider initialLocale={initialLocale}>
            {children}
            <Toaster closeButton position="bottom-right" richColors />
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
