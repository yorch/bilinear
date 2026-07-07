'use client';

import { Pencil, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { DeleteUpdateButton } from '@/components/shared/delete-update-button';
import { CreateUpdateForm, EditUpdateForm } from '@/components/shared/update-forms';
import { Badge } from '@/components/ui/badge';
import { useFormatters } from '@/hooks/use-formatters';
import { useTranslations } from '@/hooks/use-translations';
import { gql } from '@/lib/graphql';
import {
  INITIATIVE_UPDATE_CREATE_MUTATION,
  INITIATIVE_UPDATE_EDIT_MUTATION,
  INITIATIVE_UPDATES_QUERY,
} from '@/lib/graphql-queries';
import { PROJECT_HEALTH_CONFIG, PROJECT_HEALTH_LABEL_KEYS } from '@/lib/project-constants';

interface InitiativeUpdate {
  body: string;
  createdAt: string;
  editedAt: string | null;
  health: string | null;
  id: string;
  user: { id: string; displayName: string };
}

interface InitiativeUpdatesSectionProps {
  initiativeId: string;
  viewerId: string;
}

export function InitiativeUpdatesSection({
  initiativeId,
  viewerId,
}: InitiativeUpdatesSectionProps) {
  const t = useTranslations();
  const { formatRelativeTime } = useFormatters();
  const [updates, setUpdates] = useState<InitiativeUpdate[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const fetchUpdates = useCallback(async () => {
    try {
      const res = await gql(INITIATIVE_UPDATES_QUERY, { id: initiativeId });
      const data = res.data as { initiative?: { updates: InitiativeUpdate[] } } | undefined;
      setUpdates(data?.initiative?.updates ?? []);
    } finally {
      setLoading(false);
    }
  }, [initiativeId]);

  useEffect(() => {
    fetchUpdates();
  }, [fetchUpdates]);

  const openCreate = () => {
    setEditingId(null);
    setCreating(true);
  };

  const openEdit = (id: string) => {
    setCreating(false);
    setEditingId(id);
  };

  if (loading) {
    return (
      <div className="mt-3 text-xs text-muted-foreground">{t('initiatives.updates.loading')}</div>
    );
  }

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t('initiatives.updates.title', { count: updates.length })}
        </h4>
        {!creating && !editingId && (
          <button
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-zinc-700 dark:hover:text-zinc-300"
            onClick={openCreate}
            type="button"
          >
            <Plus className="h-3.5 w-3.5" />
            {t('initiatives.updates.addUpdate')}
          </button>
        )}
      </div>

      {creating && (
        <CreateUpdateForm
          onClose={() => setCreating(false)}
          onSubmit={async (body, health) => {
            const res = await gql(INITIATIVE_UPDATE_CREATE_MUTATION, {
              input: { body, bodyData: {}, health: health || null, initiativeId },
            });
            if (res.errors?.length) {
              throw new Error(t('common.somethingWentWrong'));
            }
            await fetchUpdates();
          }}
          showNone
        />
      )}

      {updates.length === 0 && !creating ? (
        <p className="py-4 text-center text-xs text-muted-foreground">
          {t('initiatives.updates.empty')}
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {updates.map(update => {
            const isOwner = update.user.id === viewerId;
            const health = update.health ? PROJECT_HEALTH_CONFIG[update.health] : null;

            if (editingId === update.id) {
              return (
                <EditUpdateForm
                  initialBody={update.body}
                  initialHealth={update.health ?? ''}
                  key={update.id}
                  onClose={() => setEditingId(null)}
                  onSave={async (body, health) => {
                    const res = await gql(INITIATIVE_UPDATE_EDIT_MUTATION, {
                      id: update.id,
                      input: { body, bodyData: {}, health: health || null },
                    });
                    if (res.errors?.length) {
                      throw new Error(t('common.somethingWentWrong'));
                    }
                    await fetchUpdates();
                  }}
                  showNone
                />
              );
            }

            return (
              <div className="rounded-lg border border-border p-4" key={update.id}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                      {update.user.displayName}
                    </span>
                    {health && (
                      <Badge className={health.color} variant="solid">
                        {t(PROJECT_HEALTH_LABEL_KEYS[update.health ?? ''])}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {formatRelativeTime(update.createdAt)}
                      {update.editedAt && ` (${t('initiatives.updates.edited')})`}
                    </span>
                  </div>
                  {isOwner && (
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-zinc-600 dark:hover:text-zinc-300"
                        onClick={() => openEdit(update.id)}
                        title={t('common.edit')}
                        type="button"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <DeleteUpdateButton
                        mutation={`mutation ($id: ID!) { initiativeUpdateDelete(id: $id) { success } }`}
                        onDeleted={fetchUpdates}
                        updateId={update.id}
                      />
                    </div>
                  )}
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
                  {update.body}
                </p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
