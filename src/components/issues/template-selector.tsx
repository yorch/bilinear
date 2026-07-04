'use client';

import { ChevronDown, FileText, Star, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { usePopover } from '@/hooks/use-popover';
import { useTranslations } from '@/hooks/use-translations';
import { gql } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';

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
  const { open, setOpen, ref: dropdownRef } = usePopover({ forceOpen, onClose });

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

  // Close on Escape
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        onClose?.();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose, setOpen]);

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

  const closeDropdown = () => {
    setOpen(false);
    onClose?.();
  };

  const handleSelect = (template: IssueTemplate) => {
    onSelect(template.templateData);
    closeDropdown();
  };

  if (templates.length === 0 && !loading) {
    return null;
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className={cn(
          'flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
          open
            ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-600 dark:bg-indigo-950 dark:text-indigo-300'
            : 'border-zinc-200 bg-zinc-50 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700',
        )}
        onClick={() => setOpen(o => !o)}
        type="button"
      >
        <FileText className="h-3.5 w-3.5" />
        {t('issueDetail.templates.applyTemplate')}
        <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div
          aria-label={t('issueDetail.templates.title')}
          className="absolute left-0 top-full z-20 mt-1 w-72 rounded-lg border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
          role="listbox"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
            <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
              {t('issueDetail.templates.title')}
            </span>
            <button
              aria-label={t('common.close')}
              className="rounded p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              onClick={closeDropdown}
              type="button"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {loading ? (
            <p className="px-3 py-4 text-center text-xs text-zinc-400">
              {t('issueDetail.templates.loading')}
            </p>
          ) : sorted.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-zinc-400 italic">
              {t('issueDetail.templates.noneForTeam')}
            </p>
          ) : (
            <ul className="max-h-64 overflow-y-auto py-1">
              {sorted.map(template => (
                <li key={template.id}>
                  <button
                    aria-selected={false}
                    className="w-full px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800"
                    onClick={() => handleSelect(template)}
                    role="option"
                    type="button"
                  >
                    <div className="flex items-center gap-2">
                      <span className="flex-1 truncate text-sm font-medium text-zinc-800 dark:text-zinc-200">
                        {template.name}
                      </span>
                      {template.isDefault && (
                        <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />
                      )}
                    </div>
                    {template.description && (
                      <p className="mt-0.5 truncate text-xs text-zinc-400">
                        {template.description}
                      </p>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
