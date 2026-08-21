'use client';

import { SettingRow } from '@/components/settings/setting-row';
import { InlineRetry } from '@/components/shared/inline-retry';
import { RowsSkeleton } from '@/components/ui/skeleton';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import { satisfiesRole } from '@/lib/config';
import {
  clearSetting,
  fetchSettings,
  groupByArea,
  type ResolvedSettingDto,
  setSetting,
} from '@/lib/settings-api';
import { toast } from '@/lib/toast';
import { getErrorMessage } from '@/lib/utils';

/**
 * Platform-wide configuration console.
 *
 * Every row is rendered from the registry rather than hand-written, so adding a
 * knob is one `defineSetting` entry and nothing here changes. The page shows
 * the *effective* value and where it came from, which is what makes "why is it
 * behaving like that here" answerable without reading source.
 *
 * Platform scope only. Per-tenant overrides are edited on the tenant detail
 * page, and workspace-level knobs on the workspace settings page — same
 * component, different scope.
 */
export default function AdminConfigPage() {
  const t = useTranslations();
  useDocumentTitle(t('admin.nav.config'));

  const {
    cause,
    data: settings,
    error,
    loading,
    refetch,
    setData,
  } = useRetryableFetch<ResolvedSettingDto[]>(() => fetchSettings('platform'), [], []);

  // Replace one row in place. The server returns the *re-resolved* setting, so
  // a write that falls back to a lower layer (a clear) reports the layer that
  // now supplies the value rather than optimistically guessing it.
  const applyUpdated = (updated: ResolvedSettingDto) => {
    setData(prev => prev.map(s => (s.key === updated.key ? updated : s)));
  };

  const handleChange = async (
    setting: ResolvedSettingDto,
    value: boolean | number | string | null,
  ) => {
    try {
      const updated =
        value === null
          ? await clearSetting(setting.key, 'platform')
          : await setSetting(setting.key, 'platform', value);
      applyUpdated(updated);
      toast.success(value === null ? t('config.resetToast') : t('config.savedToast'));
    } catch (err) {
      toast.error(getErrorMessage(err, t('config.saveError')));
      // Rethrow so SettingRow reverts its draft. Swallowing here left the
      // rejected value in the field, which then re-submitted on every blur.
      throw err;
    }
  };

  if (loading) {
    return <RowsSkeleton count={8} />;
  }

  if (error) {
    // The admin console is the surface where the server's own text is the
    // diagnostic — see .claude/rules/frontend.md on useRetryableFetch.
    return (
      <InlineRetry message={getErrorMessage(cause, t('config.loadError'))} onRetry={refetch} />
    );
  }

  const groups = groupByArea(settings);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-semibold text-foreground text-lg">{t('config.title')}</h1>
        <p className="mt-1 text-muted-foreground text-sm">{t('config.description')}</p>
      </div>

      {groups.map(({ area, items }) => (
        <section key={area}>
          <h2 className="mb-1 font-medium text-muted-foreground text-xs uppercase tracking-wide">
            {t(`config.areas.${area}`)}
          </h2>
          <div className="rounded-lg border border-border px-4">
            {items.map(setting => (
              <SettingRow
                key={setting.key}
                onChange={value => handleChange(setting, value)}
                scope="platform"
                setting={setting}
                // Every knob listed here is writable: this route is
                // platform-admin only (the (admin) layout redirects everyone
                // else), and `editableBy` is a floor, not an equality — a
                // platform admin satisfies an org-admin knob too. Comparing
                // with `===` rendered every org-admin-editable knob read-only
                // at platform scope, i.e. exactly the knobs a tenant is
                // expected to override *below* a platform default.
                writable={satisfiesRole('platform-admin', setting.editableBy)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
