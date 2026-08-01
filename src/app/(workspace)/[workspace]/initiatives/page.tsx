'use client';

import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import { InitiativeUpdatesSection } from '@/components/initiatives/initiative-updates-section';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useTranslations } from '@/hooks/use-translations';
import type { DBInitiative } from '@/lib/db';
import { gql } from '@/lib/graphql';
import { computeProjectProgress } from '@/lib/project-constants';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

/**
 * Initiatives — top-level strategic groupings of projects toward a
 * multi-quarter goal. Progress rolls up from linked projects.
 */

const INITIATIVE_CREATE_MUTATION = `
  mutation InitiativeCreate($input: InitiativeCreateInput!) {
    initiativeCreate(input: $input) {
      success
      lastSyncId
      initiative {
        id
        name
        status
        progress
        targetDate
      }
    }
  }
`;

const INITIATIVE_UPDATE_MUTATION = `
  mutation InitiativeUpdate($id: ID!, $input: InitiativeUpdateInput!) {
    initiativeUpdate(id: $id, input: $input) {
      success
      lastSyncId
      initiative { id status }
    }
  }
`;

const INITIATIVE_ADD_PROJECT_MUTATION = `
  mutation InitiativeAddProject($initiativeId: ID!, $projectId: ID!) {
    initiativeAddProject(initiativeId: $initiativeId, projectId: $projectId) {
      success
      lastSyncId
    }
  }
`;

const INITIATIVE_REMOVE_PROJECT_MUTATION = `
  mutation InitiativeRemoveProject($initiativeId: ID!, $projectId: ID!) {
    initiativeRemoveProject(initiativeId: $initiativeId, projectId: $projectId) {
      success
      lastSyncId
    }
  }
`;

const STATUS_ORDER = ['active', 'planned', 'completed', 'canceled'];

function useStatusLabels() {
  const t = useTranslations();
  return {
    active: t('initiatives.status.active'),
    canceled: t('initiatives.status.canceled'),
    completed: t('initiatives.status.completed'),
    planned: t('initiatives.status.planned'),
  } as Record<string, string>;
}

function InitiativeRow({ depth = 0, initiative }: { depth?: number; initiative: DBInitiative }) {
  const t = useTranslations();
  const STATUS_LABELS = useStatusLabels();
  const { initiativeStore, issueStore, projectStore, userStore } = useStore();
  const viewerId = userStore.currentUser?.id ?? '';
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const children = initiativeStore.getChildren(initiative.id);
  const projectIds = initiativeStore.getProjectIds(initiative.id);
  const projects = projectIds
    .map(id => projectStore.findById(id))
    .filter((p): p is NonNullable<typeof p> => p !== null);

  const allProjects = projectStore.all.filter(p => !projectIds.includes(p.id));

  const indentPx = depth * 20;
  return (
    <div className="border-b border-border">
      <button
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-accent/50"
        onClick={() => setExpanded(e => !e)}
        style={{ paddingLeft: `${16 + indentPx}px` }}
        type="button"
      >
        {children.length > 0 && (
          <span
            className={cn(
              'text-muted-foreground text-xs shrink-0 transition-transform',
              expanded && 'rotate-90',
            )}
          >
            ▶
          </span>
        )}
        <span
          className="inline-block h-3 w-3 shrink-0 rounded"
          style={{ backgroundColor: initiative.color }}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">
            {initiative.name}
          </span>
          {initiative.description ? (
            <span className="block truncate text-xs text-muted-foreground">
              {initiative.description}
            </span>
          ) : null}
        </span>
        <span className="rounded bg-muted px-2 py-0.5 text-xs text-foreground-secondary">
          {STATUS_LABELS[initiative.status] ?? initiative.status}
        </span>
        <span className="text-xs text-muted-foreground">
          {Math.round(initiative.progress * 100)}%
        </span>
        <span className="w-20 text-xs text-muted-foreground">{initiative.targetDate ?? ''}</span>
      </button>
      {expanded ? (
        <div className="px-12 pb-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-foreground-secondary">
              {t('initiatives.row.projects', { count: projects.length })}
            </span>
            <button
              className="rounded border border-border px-2 py-0.5 text-xs hover:bg-muted"
              onClick={() => setAdding(a => !a)}
              type="button"
            >
              {adding ? t('common.cancel') : t('initiatives.row.addProject')}
            </button>
          </div>
          {adding ? (
            <div className="mb-2 max-h-40 overflow-y-auto rounded border border-border">
              {allProjects.length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  {t('initiatives.row.noProjectsToAdd')}
                </div>
              ) : (
                allProjects.map(p => (
                  <button
                    className="block w-full px-3 py-1.5 text-left text-xs hover:bg-accent"
                    key={p.id}
                    onClick={async () => {
                      const res = await gql(INITIATIVE_ADD_PROJECT_MUTATION, {
                        initiativeId: initiative.id,
                        projectId: p.id,
                      });
                      if (res.errors?.length) {
                        toast.error(t('initiatives.row.addProjectFailed'));
                      } else {
                        toast.success(t('initiatives.row.addedProject', { name: p.name }));
                        setAdding(false);
                      }
                    }}
                    type="button"
                  >
                    {p.name}
                  </button>
                ))
              )}
            </div>
          ) : null}
          {projects.length === 0 ? (
            <div className="text-xs text-muted-foreground">
              {t('initiatives.row.noProjectsYet')}
            </div>
          ) : (
            <div className="space-y-1">
              {projects.map(p => (
                <div
                  className="flex items-center gap-2 text-xs text-foreground-secondary"
                  key={p.id}
                >
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: p.color }}
                  />
                  <span className="flex-1">{p.name}</span>
                  <span className="text-muted-foreground">
                    {Math.round(computeProjectProgress(issueStore.findByProjectId(p.id)) * 100)}%
                  </span>
                  <button
                    className="text-muted-foreground hover:text-red-500 max-md:flex max-md:h-11 max-md:min-w-11 max-md:items-center max-md:justify-center"
                    onClick={async () => {
                      const res = await gql(INITIATIVE_REMOVE_PROJECT_MUTATION, {
                        initiativeId: initiative.id,
                        projectId: p.id,
                      });
                      if (res.errors?.length) {
                        toast.error(
                          (res.errors[0] as { message?: string })?.message ??
                            t('initiatives.row.removeProjectFailed'),
                        );
                      } else {
                        toast.success(t('initiatives.row.removedProject', { name: p.name }));
                      }
                    }}
                    title={t('initiatives.row.removeProjectTitle', { name: p.name })}
                    type="button"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="mt-3 flex gap-1">
            {STATUS_ORDER.map(s => (
              <button
                className={cn(
                  'rounded border px-2 py-0.5 text-xs',
                  initiative.status === s
                    ? 'border-brand bg-brand-subtle text-brand-subtle-foreground'
                    : 'border-border',
                )}
                key={s}
                onClick={async () => {
                  await gql(INITIATIVE_UPDATE_MUTATION, {
                    id: initiative.id,
                    input: { status: s },
                  });
                }}
                type="button"
              >
                {STATUS_LABELS[s]}
              </button>
            ))}
          </div>
          <InitiativeUpdatesSection initiativeId={initiative.id} viewerId={viewerId} />
        </div>
      ) : null}
      {/* Sub-initiatives — rendered regardless of expansion so the tree is always visible */}
      {children.map(child => (
        <InitiativeRow depth={depth + 1} initiative={child} key={child.id} />
      ))}
    </div>
  );
}

const InitiativesPage = observer(function InitiativesPage() {
  const t = useTranslations();
  useDocumentTitle(t('initiatives.page.title'));
  const STATUS_LABELS = useStatusLabels();
  const { initiativeStore, syncStore } = useStore();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (creating) {
      inputRef.current?.focus();
    }
  }, [creating]);

  // Only top-level (root) initiatives — children render recursively inside InitiativeRow.
  const rootInitiatives = initiativeStore.roots;
  const grouped = STATUS_ORDER.map(status => ({
    items: rootInitiatives.filter(i => i.status === status),
    status,
  })).filter(g => g.items.length > 0);

  const handleCreate = async () => {
    if (!name.trim()) {
      return;
    }
    const res = await gql(INITIATIVE_CREATE_MUTATION, { input: { name: name.trim() } });
    if (res.errors?.length) {
      toast.error(t('initiatives.page.createFailed'));
    } else {
      toast.success(t('initiatives.page.createdSuccess'));
      setName('');
      setCreating(false);
    }
  };

  const isLoading = syncStore.status === 'bootstrapping' || syncStore.status === 'idle';

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        {t('common.loading')}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-6 py-3">
        <h1 className="text-sm font-semibold text-foreground">{t('initiatives.page.title')}</h1>
        <button
          className="rounded bg-primary px-2.5 py-1 text-xs text-white hover:bg-primary/90"
          onClick={() => setCreating(c => !c)}
          type="button"
        >
          {creating ? t('common.cancel') : t('initiatives.page.newInitiative')}
        </button>
      </div>

      {creating ? (
        <div className="flex items-center gap-2 border-b border-border px-6 py-2">
          <input
            className="flex-1 rounded border border-border bg-transparent px-2 py-1 text-sm"
            onChange={e => setName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                handleCreate();
              } else if (e.key === 'Escape') {
                setCreating(false);
                setName('');
              }
            }}
            placeholder={t('initiatives.page.namePlaceholder')}
            ref={inputRef}
            value={name}
          />
          <button
            className="rounded bg-primary px-2.5 py-1 text-xs text-white hover:bg-primary/90"
            onClick={handleCreate}
            type="button"
          >
            {t('common.create')}
          </button>
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto">
        {grouped.length === 0 ? (
          <div className="flex items-center justify-center py-20 text-sm text-muted-foreground">
            {t('initiatives.page.empty')}
          </div>
        ) : (
          grouped.map(({ status, items }) => (
            <div key={status}>
              <div className="border-b border-border bg-card px-4 py-1.5">
                <span className="text-xs font-medium text-foreground-secondary">
                  {STATUS_LABELS[status]}
                </span>
                <span className="ml-2 text-xs text-muted-foreground">{items.length}</span>
              </div>
              {items.map(initiative => (
                <InitiativeRow initiative={initiative} key={initiative.id} />
              ))}
            </div>
          ))
        )}
      </div>
    </div>
  );
});

export default InitiativesPage;
