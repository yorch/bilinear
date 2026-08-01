'use client';

import { Pencil, Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { DeleteUpdateButton } from '@/components/shared/delete-update-button';
import { InlineRetry } from '@/components/shared/inline-retry';
import { CreateUpdateForm, EditUpdateForm } from '@/components/shared/update-forms';
import { Badge } from '@/components/ui/badge';
import { useFormatters } from '@/hooks/use-formatters';
import { useTranslations } from '@/hooks/use-translations';
import { gql, gqlQuery } from '@/lib/graphql';
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
  const [loadError, setLoadError] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // The create/edit handlers below already reject on `res.errors`; the load
  // path did not, so a failed read rendered as "Updates (0)" / "No updates
  // yet". `gqlQuery` throws, and the error surfaces as an inline retry.
  const fetchUpdates = useCallback(async () => {
    setLoadError(false);
    try {
      const initiative = await gqlQuery<{ updates: InitiativeUpdate[] } | null>(
        INITIATIVE_UPDATES_QUERY,
        { id: initiativeId },
        'initiative',
      );
      setUpdates(initiative?.updates ?? []);
    } catch {
      setLoadError(true);
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
            className="flex items-center gap-1 rounded px-2 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground-secondary"
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
              // `health` is `String!` over a NOT NULL column; the form's "None"
              // is the empty string, and null fails coercion.
              input: { body, bodyData: {}, health, initiativeId },
            });
            if (res.errors?.length) {
              throw new Error(t('common.somethingWentWrong'));
            }
            await fetchUpdates();
          }}
          showNone
        />
      )}

      {loadError ? (
        <InlineRetry message={t('common.somethingWentWrong')} onRetry={fetchUpdates} />
      ) : updates.length === 0 && !creating ? (
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
                      input: { body, bodyData: {}, health },
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
                    <span className="text-xs font-medium text-foreground-secondary">
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
                        className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground-secondary max-md:flex max-md:h-11 max-md:min-w-11 max-md:items-center max-md:justify-center"
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
                <p className="mt-2 whitespace-pre-wrap text-sm text-foreground-secondary">
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
