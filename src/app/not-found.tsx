import Link from 'next/link';
import { getServerTranslations } from '@/lib/i18n/server';

/**
 * Root 404 boundary — keeps unknown URLs inside the app's styling instead
 * of Next's bare default, with a way back home.
 */
export default async function NotFound() {
  const { t } = await getServerTranslations();

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center">
      <p className="font-mono text-xs text-zinc-400">404</p>
      <h1 className="text-xl font-semibold text-zinc-900 dark:text-zinc-50">
        {t('errors.notFoundTitle')}
      </h1>
      <p className="max-w-md text-sm text-zinc-600 dark:text-zinc-400">
        {t('errors.notFoundDetail')}
      </p>
      <Link
        className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground shadow hover:bg-primary/90"
        href="/"
      >
        {t('errors.goHome')}
      </Link>
    </div>
  );
}
