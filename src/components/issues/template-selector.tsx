'use client';

import { ChevronDown, FileText, Star, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  id: string;
  name: string;
  description?: string | null;
  templateData: object;
  isDefault: boolean;
}

interface TemplateSelectorProps {
  teamId: string;
  onSelect: (templateData: object) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function TemplateSelector({ teamId, onSelect }: TemplateSelectorProps) {
  const [templates, setTemplates] = useState<IssueTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

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
        toast.error('Failed to load templates');
      })
      .finally(() => {
        setLoading(false);
      });
  }, [teamId]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) {
      return;
    }
    const handleClickOutside = (e: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

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

  const handleSelect = (template: IssueTemplate) => {
    onSelect(template.templateData);
    setOpen(false);
  };

  if (templates.length === 0 && !loading) {
    return null;
  }

  return (
    <div ref={dropdownRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={cn(
          'flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors',
          open
            ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-600 dark:bg-indigo-950 dark:text-indigo-300'
            : 'border-zinc-200 bg-zinc-50 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700',
        )}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <FileText className="h-3.5 w-3.5" />
        Apply template
        <ChevronDown
          className={cn('h-3 w-3 transition-transform', open && 'rotate-180')}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Issue templates"
          className="absolute left-0 top-full z-20 mt-1 w-72 rounded-lg border border-zinc-200 bg-white py-1 shadow-xl dark:border-zinc-700 dark:bg-zinc-900"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-zinc-100 px-3 py-2 dark:border-zinc-800">
            <span className="text-xs font-semibold text-zinc-500 dark:text-zinc-400">
              Templates
            </span>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded p-0.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              aria-label="Close"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {loading ? (
            <p className="px-3 py-4 text-center text-xs text-zinc-400">
              Loading templates…
            </p>
          ) : sorted.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-zinc-400 italic">
              No templates for this team.
            </p>
          ) : (
            <ul className="max-h-64 overflow-y-auto py-1">
              {sorted.map(template => (
                <li key={template.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => handleSelect(template)}
                    className="w-full px-3 py-2 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800"
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
