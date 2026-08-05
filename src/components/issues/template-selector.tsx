'use client';

import { FileText, Star, X } from 'lucide-react';
import { useMemo } from 'react';
import { InlineRetry } from '@/components/shared/inline-retry';
import { SelectPopover } from '@/components/ui/select-popover';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import { gqlQuery } from '@/lib/graphql';
import { ISSUE_TEMPLATES_QUERY } from '@/lib/graphql-queries';
import { toast } from '@/lib/toast';
import { cn, TOUCH_TARGET } from '@/lib/utils';

// ─── Types ────────────────────────────────────────────────────────────────────

interface IssueTemplate {
  description?: string | null;
  id: string;
  isDefault: boolean;
  name: string;
  templateData: object;
}

interface TemplateSelectorProps {
  forceOpen?: boolean;
  onClose?: () => void;
  onSelect: (templateData: object) => void;
  teamId: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TemplateSelector({ teamId, onSelect, forceOpen, onClose }: TemplateSelectorProps) {
  const t = useTranslations();
  // A failed read must not leave `templates` at [], which would unmount the
  // whole picker as if the team simply had none.
  const {
    data: templates,
    error: loadError,
    loading,
    refetch,
  } = useRetryableFetch<IssueTemplate[]>(
    async () => {
      try {
        const data = await gqlQuery<IssueTemplate[]>(
          ISSUE_TEMPLATES_QUERY,
          { teamId },
          'issueTemplates',
        );
        return data ?? [];
      } catch (err) {
        toast.error(t('issueDetail.templates.failedToLoad'));
        throw err;
      }
    },
    [teamId, t],
    [],
  );

  // Sort: default first, then alphabetical
  const sorted = useMemo(
    () =>
      [...templates].sort((a, b) => {
        if (a.isDefault !== b.isDefault) {
          return a.isDefault ? -1 : 1;
        }
        return a.name.localeCompare(b.name);
      }),
    [templates],
  );

  // Keep the trigger mounted on a failed load so the panel can offer a retry
  // instead of the section disappearing as if there were no templates.
  if (templates.length === 0 && !loading && !loadError) {
    return null;
  }

  return (
    <SelectPopover
      forceOpen={forceOpen}
      onClose={onClose}
      panelClassName="w-72 py-1"
      triggerChildren={
        <>
          <FileText className="h-3.5 w-3.5" />
          {t('issueDetail.templates.applyTemplate')}
        </>
      }
      triggerClassName="gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
    >
      {close => (
        <>
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-xs font-semibold text-muted-foreground">
              {t('issueDetail.templates.title')}
            </span>
            <button
              aria-label={t('common.close')}
              className={cn(
                'rounded p-0.5 text-muted-foreground hover:text-foreground-secondary',
                TOUCH_TARGET,
              )}
              onClick={close}
              type="button"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {loading ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              {t('issueDetail.templates.loading')}
            </p>
          ) : loadError ? (
            <InlineRetry
              className="px-3"
              message={t('issueDetail.templates.failedToLoad')}
              onRetry={refetch}
            />
          ) : sorted.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground italic">
              {t('issueDetail.templates.noneForTeam')}
            </p>
          ) : (
            <ul className="max-h-64 overflow-y-auto py-1">
              {sorted.map(template => (
                <li key={template.id}>
                  <button
                    className="w-full px-3 py-2 text-left hover:bg-accent"
                    onClick={() => {
                      onSelect(template.templateData);
                      close();
                    }}
                    type="button"
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex-1 truncate text-sm font-medium text-foreground">
                        {template.name}
                      </span>
                      {template.isDefault && (
                        <Star className="h-3.5 w-3.5 shrink-0 fill-warning text-warning-subtle-foreground" />
                      )}
                    </div>
                    {template.description && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">
                        {template.description}
                      </p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </SelectPopover>
  );
}
