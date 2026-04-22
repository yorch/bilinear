'use client';

import { ChevronDown, Plus, Trash2, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useMemo, useRef, useState } from 'react';
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

const RELATION_TYPES = [
  'blocks',
  'blocked_by',
  'related',
  'duplicate',
] as const;

type RelationType = (typeof RELATION_TYPES)[number];

const RELATION_TYPE_LABELS: Record<RelationType, string> = {
  blocked_by: 'Blocked by',
  blocks: 'Blocks',
  duplicate: 'Duplicate of',
  related: 'Related to',
};

interface RelatedIssueRef {
  id: string;
  identifier: string;
  title: string;
}

interface IssueRelation {
  id: string;
  type: string;
  issueId: string;
  relatedIssueId: string;
  issue: RelatedIssueRef;
  relatedIssue: RelatedIssueRef;
}

interface RelationsSectionProps {
  issueId: string;
}

// ─── Main component ───────────────────────────────────────────────────────────

export const RelationsSection = observer(function RelationsSection({
  issueId,
}: RelationsSectionProps) {
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
          toast.error('Failed to load relations');
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
  }, [issueId]);

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
      toast.error('Failed to delete relation');
      setRelations(prev);
    }
  };

  const handleCreate = async (
    type: RelationType,
    relatedIdentifier: string,
  ) => {
    const normalized = relatedIdentifier.trim().toUpperCase();

    // Resolve identifier → UUID using the local issue store
    const relatedIssue = Array.from(store.issueStore.pool.values()).find(
      i => i.identifier === normalized,
    );
    if (!relatedIssue) {
      toast.error(`Issue "${normalized}" not found`);
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
      toast.error('Failed to create relation');
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
          Relations {relations.length > 0 && `(${relations.length})`}
        </h3>
        {!showAddForm && (
          <button
            type="button"
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
          >
            <Plus className="h-3.5 w-3.5" />
            Add relation
          </button>
        )}
      </div>

      {loading && <p className="mt-2 text-xs text-zinc-400 italic">Loading…</p>}

      {!loading && relations.length === 0 && !showAddForm && (
        <p className="mt-2 text-xs text-zinc-400 italic">No relations.</p>
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
                    const other =
                      rel.issueId === issueId ? rel.relatedIssue : rel.issue;
                    return (
                      <li
                        key={rel.id}
                        className="group flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800"
                      >
                        <span className="shrink-0 font-mono text-xs text-zinc-400">
                          {other?.identifier ?? '—'}
                        </span>
                        <span className="flex-1 truncate text-zinc-700 dark:text-zinc-300">
                          {other?.title ?? 'Unknown issue'}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleDelete(rel.id)}
                          className="hidden items-center rounded p-0.5 text-zinc-400 hover:text-red-500 group-hover:flex"
                          aria-label="Remove relation"
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
          onSubmit={handleCreate}
          onClose={() => setShowAddForm(false)}
        />
      )}
    </div>
  );
});

// ─── Add relation form ────────────────────────────────────────────────────────

interface AddRelationFormProps {
  onSubmit: (type: RelationType, identifier: string) => Promise<void>;
  onClose: () => void;
}

function AddRelationForm({ onSubmit, onClose }: AddRelationFormProps) {
  const [type, setType] = useState<RelationType>('related');
  const [identifier, setIdentifier] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [typeOpen, setTypeOpen] = useState(false);
  const typeDropdownRef = useRef<HTMLDivElement>(null);

  // Close type dropdown on outside click
  useEffect(() => {
    if (!typeOpen) {
      return;
    }
    const handler = (e: MouseEvent) => {
      if (!typeDropdownRef.current?.contains(e.target as Node)) {
        setTypeOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [typeOpen]);

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
      onSubmit={handleSubmit}
      className="mt-2 rounded-md border border-zinc-200 p-3 dark:border-zinc-700"
    >
      <div className="flex items-center gap-2">
        {/* Type selector */}
        <div ref={typeDropdownRef} className="relative">
          <button
            type="button"
            onClick={() => setTypeOpen(o => !o)}
            className="flex items-center gap-1 rounded border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
          >
            {RELATION_TYPE_LABELS[type]}
            <ChevronDown className="h-3 w-3" />
          </button>
          {typeOpen && (
            <div className="absolute left-0 top-full z-10 mt-1 w-36 rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              {RELATION_TYPES.map(t => (
                <button
                  key={t}
                  type="button"
                  onClick={() => {
                    setType(t);
                    setTypeOpen(false);
                  }}
                  className={cn(
                    'w-full px-3 py-1.5 text-left text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800',
                    t === type
                      ? 'text-indigo-600 dark:text-indigo-400'
                      : 'text-zinc-700 dark:text-zinc-300',
                  )}
                >
                  {RELATION_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Issue identifier input */}
        <input
          type="text"
          placeholder="Issue identifier (e.g. ENG-123)"
          value={identifier}
          onChange={e => setIdentifier(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') {
              onClose();
            }
          }}
          className="flex-1 rounded border border-zinc-200 bg-transparent px-2 py-1 text-xs text-zinc-900 placeholder-zinc-400 outline-none focus:border-indigo-400 dark:border-zinc-700 dark:text-zinc-100"
        />

        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          aria-label="Cancel"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="mt-2 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded px-3 py-1 text-xs text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={!identifier.trim() || submitting}
          className="rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          {submitting ? 'Adding…' : 'Add'}
        </button>
      </div>
    </form>
  );
}
