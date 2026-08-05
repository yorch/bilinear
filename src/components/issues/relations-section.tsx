'use client';

import { ChevronDown, Trash2, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useMemo, useRef, useState } from 'react';
import { IssuePicker } from '@/components/issues/issue-picker';
import { InlineRetry } from '@/components/shared/inline-retry';
import { SectionAddButton, SectionHeader } from '@/components/shared/section-header';
import { useOutsideClick } from '@/hooks/use-outside-click';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import type { DBIssue } from '@/lib/db';
import { gqlQuery } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { TransactionQueue } from '@/lib/transaction-queue';
import { cn, TOUCH_TARGET } from '@/lib/utils';

// ─── GraphQL documents ────────────────────────────────────────────────────────

const GET_ISSUE_RELATIONS = `
  query GetIssueRelations($issueId: ID!) {
    issueRelations(issueId: $issueId) {
      id
      type
      issueId
      relatedIssueId
      issue { id identifier title }
      relatedIssue { id identifier title }
    }
  }
`;

const CREATE_ISSUE_RELATION = `
  mutation CreateIssueRelation($input: IssueRelationCreateInput!) {
    issueRelationCreate(input: $input) {
      success
      lastSyncId
      issueRelation { id type issueId relatedIssueId }
    }
  }
`;

const DELETE_ISSUE_RELATION = `
  mutation DeleteIssueRelation($id: ID!) {
    issueRelationDelete(id: $id) {
      success
      lastSyncId
    }
  }
`;

// ─── Types ────────────────────────────────────────────────────────────────────

const RELATION_TYPES = ['blocks', 'blocked_by', 'related', 'duplicate'] as const;

type RelationType = (typeof RELATION_TYPES)[number];

function getRelationTypeLabels(
  t: ReturnType<typeof useTranslations>,
): Record<RelationType, string> {
  return {
    blocked_by: t('issueDetail.relations.blockedBy'),
    blocks: t('issueDetail.relations.blocks'),
    duplicate: t('issueDetail.relations.duplicateOf'),
    related: t('issueDetail.relations.relatedTo'),
  };
}

interface RelatedIssueRef {
  id: string;
  identifier: string;
  title: string;
}

interface IssueRelation {
  id: string;
  issue: RelatedIssueRef;
  issueId: string;
  relatedIssue: RelatedIssueRef;
  relatedIssueId: string;
  type: string;
}

interface RelationsSectionProps {
  issueId: string;
}

// ─── Main component ───────────────────────────────────────────────────────────

export const RelationsSection = observer(function RelationsSection({
  issueId,
}: RelationsSectionProps) {
  const t = useTranslations();
  const RELATION_TYPE_LABELS = useMemo(() => getRelationTypeLabels(t), [t]);
  const [showAddForm, setShowAddForm] = useState(false);

  const tq = useMemo(() => new TransactionQueue(), []);

  // A failed read must not silently leave `relations` at [], rendering an issue
  // with real blockers as having none.
  const {
    data: relations,
    error: loadError,
    loading,
    refetch: fetchRelations,
    setData: setRelations,
  } = useRetryableFetch<IssueRelation[]>(
    async () => {
      try {
        const data = await gqlQuery<IssueRelation[]>(
          GET_ISSUE_RELATIONS,
          { issueId },
          'issueRelations',
        );
        return data ?? [];
      } catch (err) {
        toast.error(t('issueDetail.relations.failedToLoad'));
        throw err;
      }
    },
    [issueId, t],
    [],
  );

  const handleDelete = async (relationId: string) => {
    const prev = relations;
    // Optimistic removal
    setRelations(r => r.filter(rel => rel.id !== relationId));
    try {
      await new Promise<void>((resolve, reject) => {
        tq.enqueue(
          DELETE_ISSUE_RELATION,
          { id: relationId },
          { onError: reject, onSuccess: () => resolve() },
        );
      });
    } catch {
      toast.error(t('issueDetail.relations.failedToDelete'));
      setRelations(prev);
    }
  };

  const handleCreate = async (type: RelationType, relatedIssueId: string) => {
    try {
      await new Promise<void>((resolve, reject) => {
        tq.enqueue(
          CREATE_ISSUE_RELATION,
          { input: { issueId, relatedIssueId, type } },
          { onError: reject, onSuccess: () => resolve() },
        );
      });
    } catch {
      toast.error(t('issueDetail.relations.failedToCreate'));
      return;
    }
    setShowAddForm(false);
    // Refresh relations from server to get full issue objects. Reported
    // separately from the create above — a failed refresh must not read as
    // "the relation wasn't created", nor leave the list silently stale.
    await fetchRelations({ silent: true });
  };

  // Group relations by type
  const grouped = useMemo(() => {
    const map = new Map<string, IssueRelation[]>();
    for (const rel of relations) {
      const key = rel.type;
      if (!map.has(key)) {
        map.set(key, []);
      }
      map.get(key)?.push(rel);
    }
    return map;
  }, [relations]);

  return (
    <div className="mt-6">
      <SectionHeader
        action={
          !showAddForm && (
            <SectionAddButton
              label={t('issueDetail.relations.addRelation')}
              onClick={() => setShowAddForm(true)}
            />
          )
        }
        title={
          <>
            {t('issueDetail.relations.title')} {relations.length > 0 && `(${relations.length})`}
          </>
        }
      />

      {loading && (
        <p className="mt-2 text-xs text-muted-foreground italic">{t('common.loading')}</p>
      )}

      {!loading && loadError && (
        <InlineRetry
          className="py-2"
          message={t('issueDetail.relations.failedToLoad')}
          onRetry={fetchRelations}
        />
      )}

      {!loading && !loadError && relations.length === 0 && !showAddForm && (
        <p className="mt-2 text-xs text-muted-foreground italic">
          {t('issueDetail.relations.empty')}
        </p>
      )}

      {!loading && (
        <div className="mt-2 space-y-3">
          {RELATION_TYPES.map(type => {
            const items = grouped.get(type);
            if (!items?.length) {
              return null;
            }
            return (
              <div key={type}>
                <p className="mb-1 text-xs font-medium text-muted-foreground">
                  {RELATION_TYPE_LABELS[type]}
                </p>
                <ul className="space-y-0.5">
                  {items.map(rel => {
                    // Show the "other" side of the relation relative to current issue
                    const other = rel.issueId === issueId ? rel.relatedIssue : rel.issue;
                    return (
                      <li
                        className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent"
                        key={rel.id}
                      >
                        <span className="shrink-0 font-mono text-xs text-muted-foreground">
                          {other?.identifier ?? '—'}
                        </span>
                        <span className="flex-1 truncate text-foreground-secondary">
                          {other?.title ?? t('issueDetail.relations.unknownIssue')}
                        </span>
                        <button
                          aria-label={t('issueDetail.relations.removeRelation')}
                          className={cn(
                            'hidden items-center rounded p-0.5 text-muted-foreground hover:text-danger-subtle-foreground group-hover:flex',
                            TOUCH_TARGET,
                          )}
                          onClick={() => handleDelete(rel.id)}
                          type="button"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      {showAddForm && (
        <AddRelationForm
          issueId={issueId}
          onClose={() => setShowAddForm(false)}
          onSubmit={handleCreate}
        />
      )}
    </div>
  );
});

// ─── Add relation form ────────────────────────────────────────────────────────

interface AddRelationFormProps {
  issueId: string;
  onClose: () => void;
  onSubmit: (type: RelationType, relatedIssueId: string) => Promise<void>;
}

function AddRelationForm({ onSubmit, onClose, issueId }: AddRelationFormProps) {
  const t = useTranslations();
  const RELATION_TYPE_LABELS = useMemo(() => getRelationTypeLabels(t), [t]);
  const [type, setType] = useState<RelationType>('related');
  const [submitting, setSubmitting] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const typeDropdownRef = useRef<HTMLDivElement>(null);

  useOutsideClick(typeDropdownRef, () => setTypeOpen(false), typeOpen);

  const handlePick = async (issue: DBIssue) => {
    if (submitting) {
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(type, issue.id);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-2 flex items-center gap-2 rounded-md border border-border p-3">
      {/* Type selector */}
      <div className="relative" ref={typeDropdownRef}>
        <button
          className="flex items-center gap-1 rounded border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
          onClick={() => setTypeOpen(o => !o)}
          type="button"
        >
          {RELATION_TYPE_LABELS[type]}
          <ChevronDown className="h-3 w-3" />
        </button>
        {typeOpen && (
          <div className="absolute left-0 top-full z-10 mt-1 w-36 rounded-md border border-border bg-card py-1 shadow-e2">
            {RELATION_TYPES.map(t => (
              <button
                className={cn(
                  'w-full px-3 py-1.5 text-left text-xs hover:bg-accent',
                  t === type ? 'text-brand' : 'text-foreground-secondary',
                )}
                key={t}
                onClick={() => {
                  setType(t);
                  setTypeOpen(false);
                }}
                type="button"
              >
                {RELATION_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Issue picker — auto-opens on mount so clicking "Add relation" goes
          straight to search instead of requiring an extra click. */}
      <IssuePicker
        disabled={submitting}
        excludeId={issueId}
        forceOpen
        onClose={onClose}
        onSelect={handlePick}
        triggerChildren={
          submitting ? t('issueDetail.relations.adding') : t('issueDetail.relations.pickIssue')
        }
        triggerClassName="flex-1 justify-start rounded border border-border bg-transparent px-2 py-1 text-xs text-muted-foreground hover:bg-transparent"
      />

      <button
        aria-label={t('common.cancel')}
        className={cn(
          'rounded p-1 text-muted-foreground hover:text-foreground-secondary',
          TOUCH_TARGET,
        )}
        onClick={onClose}
        type="button"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
