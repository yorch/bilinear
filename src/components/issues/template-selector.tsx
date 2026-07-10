'use client';

import { FileText, Star, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { SelectPopover } from '@/components/ui/select-popover';
import { useTranslations } from '@/hooks/use-translations';
import { gql } from '@/lib/graphql';
import { toast } from '@/lib/toast';

// ─── GraphQL ──────────────────────────────────────────────────────────────────

const GET_ISSUE_TEMPLATES = `
  query GetIssueTemplates($teamId: String!) {
    issueTemplates(teamId: $teamId) {
      id
      name
      description
      templateData
      isDefault
    }
  }
`;

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
  const [templates, setTemplates] = useState<IssueTemplate[]>([]);
  const [loading, setLoading] = useState(false);

  // Load templates once when dropdown opens (or on mount if teamId is available)
  useEffect(() => {
    if (!teamId) {
      return;
    }
    setLoading(true);
    gql(GET_ISSUE_TEMPLATES, { teamId })
      .then(result => {
        const data = result.data?.issueTemplates;
        if (Array.isArray(data)) {
          setTemplates(data as IssueTemplate[]);
        }
      })
      .catch(() => {
        toast.error(t('issueDetail.templates.failedToLoad'));
      })
      .finally(() => {
        setLoading(false);
      });
  }, [teamId, t]);

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

  if (templates.length === 0 && !loading) {
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
              className="rounded p-0.5 text-muted-foreground hover:text-foreground-secondary max-md:flex max-md:h-11 max-md:min-w-11 max-md:items-center max-md:justify-center"
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
                        <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />
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
