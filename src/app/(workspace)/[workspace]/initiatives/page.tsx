'use client';

import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import type { DBInitiative } from '@/lib/db';
import { gql } from '@/lib/graphql';
import { toast } from '@/lib/toast';
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

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  canceled: 'Canceled',
  completed: 'Completed',
  planned: 'Planned',
};

const STATUS_ORDER = ['active', 'planned', 'completed', 'canceled'];

function InitiativeRow({ initiative }: { initiative: DBInitiative }) {
  const { initiativeStore, projectStore } = useStore();
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const projectIds = initiativeStore.getProjectIds(initiative.id);
  const projects = projectIds.map(id => projectStore.findById(id)).filter(p => p !== null);

  const allProjects = projectStore.all.filter(p => !projectIds.includes(p.id));

  return (
    <div className="border-b border-zinc-100 dark:border-zinc-800">
      <button
        className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-900/50"
        onClick={() => setExpanded(e => !e)}
        type="button"
      >
        <span
          className="inline-block h-3 w-3 rounded"
          style={{ backgroundColor: initiative.color }}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
            {initiative.name}
          </span>
          {initiative.description ? (
            <span className="block truncate text-xs text-zinc-500 dark:text-zinc-400">
              {initiative.description}
            </span>
          ) : null}
        </span>
        <span className="rounded bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
          {STATUS_LABELS[initiative.status] ?? initiative.status}
        </span>
        <span className="text-xs text-zinc-500 dark:text-zinc-400">
          {Math.round(initiative.progress * 100)}%
        </span>
        <span className="w-20 text-xs text-zinc-400 dark:text-zinc-500">
          {initiative.targetDate ?? ''}
        </span>
      </button>
      {expanded ? (
        <div className="px-12 pb-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Projects ({projects.length})
            </span>
            <button
              className="rounded border border-zinc-300 px-2 py-0.5 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
              onClick={() => setAdding(a => !a)}
              type="button"
            >
              {adding ? 'Cancel' : '+ Add project'}
            </button>
          </div>
          {adding ? (
            <div className="mb-2 max-h-40 overflow-y-auto rounded border border-zinc-200 dark:border-zinc-700">
              {allProjects.length === 0 ? (
                <div className="px-3 py-2 text-xs text-zinc-400">No projects to add.</div>
              ) : (
                allProjects.map(p => (
                  <button
                    className="block w-full px-3 py-1.5 text-left text-xs hover:bg-zinc-100 dark:hover:bg-zinc-800"
                    key={p.id}
                    onClick={async () => {
                      const res = await gql(INITIATIVE_ADD_PROJECT_MUTATION, {
                        initiativeId: initiative.id,
                        projectId: p.id,
                      });
                      if (res.errors?.length) {
                        toast.error('Failed to add project');
                      } else {
                        toast.success(`Added ${p.name}`);
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
            <div className="text-xs text-zinc-400">No projects yet.</div>
          ) : (
            <div className="space-y-1">
              {projects.map(p =>
                p ? (
                  <div
                    className="flex items-center gap-2 text-xs text-zinc-700 dark:text-zinc-300"
                    key={p.id}
                  >
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: p.color }}
                    />
                    <span className="flex-1">{p.name}</span>
                    <span className="text-zinc-400">{Math.round(p.progress * 100)}%</span>
                    <button
                      className="text-zinc-400 hover:text-red-500"
                      onClick={async () => {
                        const res = await gql(INITIATIVE_REMOVE_PROJECT_MUTATION, {
                          initiativeId: initiative.id,
                          projectId: p.id,
                        });
                        if (res.errors?.length) {
                          toast.error(
                            (res.errors[0] as { message?: string })?.message ??
                              'Failed to remove project',
                          );
                        } else {
                          toast.success(`Removed ${p.name}`);
                        }
                      }}
                      title={`Remove ${p.name} from this initiative`}
                      type="button"
                    >
                      ×
                    </button>
                  </div>
                ) : null,
              )}
            </div>
          )}
          <div className="mt-3 flex gap-1">
            {STATUS_ORDER.map(s => (
              <button
                className={`rounded border px-2 py-0.5 text-xs ${initiative.status === s ? 'border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300' : 'border-zinc-300 dark:border-zinc-700'}`}
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
        </div>
      ) : null}
    </div>
  );
}

const InitiativesPage = observer(function InitiativesPage() {
  const { initiativeStore, syncStore } = useStore();
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');

  const inputRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (creating) {
      inputRef.current?.focus();
    }
  }, [creating]);

  const initiatives = initiativeStore.all;
  // Group by status, with a stable ordering: active → planned → completed → canceled.
  const grouped = STATUS_ORDER.map(status => ({
    items: initiatives.filter(i => i.status === status),
    status,
  })).filter(g => g.items.length > 0);

  const handleCreate = async () => {
    if (!name.trim()) {
      return;
    }
    const res = await gql(INITIATIVE_CREATE_MUTATION, { input: { name: name.trim() } });
    if (res.errors?.length) {
      toast.error('Failed to create initiative');
    } else {
      toast.success('Initiative created');
      setName('');
      setCreating(false);
    }
  };

  const isLoading = syncStore.status === 'bootstrapping' || syncStore.status === 'idle';

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
        Loading...
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
        <h1 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Initiatives</h1>
        <button
          className="rounded bg-indigo-600 px-2.5 py-1 text-xs text-white hover:bg-indigo-700"
          onClick={() => setCreating(c => !c)}
          type="button"
        >
          {creating ? 'Cancel' : '+ New initiative'}
        </button>
      </div>

      {creating ? (
        <div className="flex items-center gap-2 border-b border-zinc-200 px-6 py-2 dark:border-zinc-800">
          <input
            className="flex-1 rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm dark:border-zinc-700"
            onChange={e => setName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                handleCreate();
              } else if (e.key === 'Escape') {
                setCreating(false);
                setName('');
              }
            }}
            placeholder="Initiative name"
            ref={inputRef}
            value={name}
          />
          <button
            className="rounded bg-indigo-600 px-2.5 py-1 text-xs text-white hover:bg-indigo-700"
            onClick={handleCreate}
            type="button"
          >
            Create
          </button>
        </div>
      ) : null}

      <div className="flex-1 overflow-y-auto">
        {grouped.length === 0 ? (
          <div className="flex items-center justify-center py-20 text-sm text-zinc-400 dark:text-zinc-500">
            No initiatives yet. Create one to start grouping projects.
          </div>
        ) : (
          grouped.map(({ status, items }) => (
            <div key={status}>
              <div className="border-b border-zinc-200 bg-zinc-50 px-4 py-1.5 dark:border-zinc-800 dark:bg-zinc-900">
                <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                  {STATUS_LABELS[status]}
                </span>
                <span className="ml-2 text-xs text-zinc-400 dark:text-zinc-500">
                  {items.length}
                </span>
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
