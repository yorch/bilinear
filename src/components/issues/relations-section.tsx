'use client';

import { ChevronDown, Plus, Trash2, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useOutsideClick } from '@/hooks/use-outside-click';
import { useTranslations } from '@/hooks/use-translations';
import { gql } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { TransactionQueue } from '@/lib/transaction-queue';
import { cn } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

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
  const store = useStore();
  const [relations, setRelations] = useState<IssueRelation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddForm, setShowAddForm] = useState(false);

  const tq = useMemo(() => new TransactionQueue(), []);

  // Fetch relations on mount / when issueId changes
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    gql(GET_ISSUE_RELATIONS, { issueId })
      .then(result => {
        if (cancelled) {
          return;
        }
        const data = result.data?.issueRelations;
        if (Array.isArray(data)) {
          setRelations(data as IssueRelation[]);
        }
      })
      .catch(() => {
        if (!cancelled) {
          toast.error(t('issueDetail.relations.failedToLoad'));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [issueId, t]);

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

  const handleCreate = async (type: RelationType, relatedIdentifier: string) => {
    const normalized = relatedIdentifier.trim().toUpperCase();

    // Resolve identifier → UUID using the local issue store
    const relatedIssue = Array.from(store.issueStore.pool.values()).find(
      i => i.identifier === normalized,
    );
    if (!relatedIssue) {
      toast.error(t('issueDetail.relations.issueNotFound', { identifier: normalized }));
      return;
    }

    try {
      await new Promise<void>((resolve, reject) => {
        tq.enqueue(
          CREATE_ISSUE_RELATION,
          { input: { issueId, relatedIssueId: relatedIssue.id, type } },
          { onError: reject, onSuccess: () => resolve() },
        );
      });
      // Refresh relations from server to get full issue objects
      const refreshed = await gql(GET_ISSUE_RELATIONS, { issueId });
      const data = refreshed.data?.issueRelations;
      if (Array.isArray(data)) {
        setRelations(data as IssueRelation[]);
      }
      setShowAddForm(false);
    } catch {
      toast.error(t('issueDetail.relations.failedToCreate'));
    }
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
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400 dark:text-zinc-500">
          {t('issueDetail.relations.title')} {relations.length > 0 && `(${relations.length})`}
        </h3>
        {!showAddForm && (
          <button
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            onClick={() => setShowAddForm(true)}
            type="button"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('issueDetail.relations.addRelation')}
          </button>
        )}
      </div>

      {loading && <p className="mt-2 text-xs text-zinc-400 italic">{t('common.loading')}</p>}

      {!loading && relations.length === 0 && !showAddForm && (
        <p className="mt-2 text-xs text-zinc-400 italic">{t('issueDetail.relations.empty')}</p>
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
                <p className="mb-1 text-xs font-medium text-zinc-400 dark:text-zinc-500">
                  {RELATION_TYPE_LABELS[type]}
                </p>
                <ul className="space-y-0.5">
                  {items.map(rel => {
                    // Show the "other" side of the relation relative to current issue
                    const other = rel.issueId === issueId ? rel.relatedIssue : rel.issue;
                    return (
                      <li
                        className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
                        key={rel.id}
                      >
                        <span className="shrink-0 font-mono text-xs text-zinc-400">
                          {other?.identifier ?? '—'}
                        </span>
                        <span className="flex-1 truncate text-zinc-700 dark:text-zinc-300">
                          {other?.title ?? t('issueDetail.relations.unknownIssue')}
                        </span>
                        <button
                          aria-label={t('issueDetail.relations.removeRelation')}
                          className="hidden items-center rounded p-0.5 text-zinc-400 hover:text-red-500 group-hover:flex"
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
        <AddRelationForm onClose={() => setShowAddForm(false)} onSubmit={handleCreate} />
      )}
    </div>
  );
});

// ─── Add relation form ────────────────────────────────────────────────────────

interface AddRelationFormProps {
  onClose: () => void;
  onSubmit: (type: RelationType, identifier: string) => Promise<void>;
}

function AddRelationForm({ onSubmit, onClose }: AddRelationFormProps) {
  const t = useTranslations();
  const RELATION_TYPE_LABELS = useMemo(() => getRelationTypeLabels(t), [t]);
  const [type, setType] = useState<RelationType>('related');
  const [identifier, setIdentifier] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const typeDropdownRef = useRef<HTMLDivElement>(null);

  useOutsideClick(typeDropdownRef, () => setTypeOpen(false), typeOpen);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!identifier.trim() || submitting) {
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(type, identifier.trim());
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      className="mt-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-700"
      onSubmit={handleSubmit}
    >
      <div className="flex items-center gap-2">
        {/* Type selector */}
        <div className="relative" ref={typeDropdownRef}>
          <button
            className="flex items-center gap-1 rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
            onClick={() => setTypeOpen(o => !o)}
            type="button"
          >
            {RELATION_TYPE_LABELS[type]}
            <ChevronDown className="h-3 w-3" />
          </button>
          {typeOpen && (
            <div className="absolute left-0 top-full z-10 mt-1 w-36 rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              {RELATION_TYPES.map(t => (
                <button
                  className={cn(
                    'w-full px-3 py-1.5 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800',
                    t === type
                      ? 'text-indigo-600 dark:text-indigo-400'
                      : 'text-zinc-700 dark:text-zinc-300',
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

        {/* Issue identifier input */}
        <input
          className="flex-1 rounded border border-zinc-200 bg-transparent px-2 py-1 text-xs text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-400 dark:border-zinc-700 dark:text-zinc-100"
          onChange={e => setIdentifier(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              onClose();
            }
          }}
          placeholder={t('issueDetail.relations.identifierPlaceholder')}
          type="text"
          value={identifier}
        />

        <button
          aria-label={t('common.cancel')}
          className="rounded p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          onClick={onClose}
          type="button"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-2 flex justify-end gap-2">
        <button
          className="rounded px-3 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          onClick={onClose}
          type="button"
        >
          {t('common.cancel')}
        </button>
        <button
          className="rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          disabled={!identifier.trim() || submitting}
          type="submit"
        >
          {submitting ? t('issueDetail.relations.adding') : t('issueDetail.relations.add')}
        </button>
      </div>
    </form>
  );
}
