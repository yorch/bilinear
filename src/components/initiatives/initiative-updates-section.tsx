'use client';

import { Pencil } from 'lucide-react';
import { useCallback, useState } from 'react';
import { DeleteUpdateButton } from '@/components/shared/delete-update-button';
import { InlineRetry } from '@/components/shared/inline-retry';
import { SectionAddButton, SectionHeader } from '@/components/shared/section-header';
import { CreateUpdateForm, EditUpdateForm } from '@/components/shared/update-forms';
import { Badge } from '@/components/ui/badge';
import { useFormatters } from '@/hooks/use-formatters';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import { gql, gqlQuery } from '@/lib/graphql';
import {
  INITIATIVE_UPDATE_CREATE_MUTATION,
  INITIATIVE_UPDATE_EDIT_MUTATION,
  INITIATIVE_UPDATES_QUERY,
} from '@/lib/graphql-queries';
import { PROJECT_HEALTH_CONFIG, PROJECT_HEALTH_LABEL_KEYS } from '@/lib/project-constants';
import { cn, TOUCH_TARGET } from '@/lib/utils';

interface InitiativeUpdate {
  body: string;
  createdAt: string;
  editedAt: string | null;
  /** `InitiativeUpdate.health` is `String!` — but the form submits `''` for "None". */
  health: string;
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
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  // The create/edit handlers below already reject on `res.errors`; a failed
  // read must not render as "Updates (0)" / "No updates yet".
  const {
    data: updates,
    error: loadError,
    loading,
    refetch,
  } = useRetryableFetch<InitiativeUpdate[]>(
    async () => {
      const initiative = await gqlQuery<{ updates: InitiativeUpdate[] } | null>(
        INITIATIVE_UPDATES_QUERY,
        { id: initiativeId },
        'initiative',
      );
      return initiative?.updates ?? [];
    },
    [initiativeId],
    [],
  );

  // Post-mutation refreshes and the inline retry stay silent: `loading` blanks
  // the whole section, which would tear down an open create/edit form.
  const fetchUpdates = useCallback(() => refetch({ silent: true }), [refetch]);

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
      <SectionHeader
        action={
          !creating &&
          !editingId && (
            <SectionAddButton label={t('initiatives.updates.addUpdate')} onClick={openCreate} />
          )
        }
        as="h4"
        title={t('initiatives.updates.title', { count: updates.length })}
      />

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
                  initialHealth={update.health}
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
                      <Badge tone={health.tone}>
                        {t(PROJECT_HEALTH_LABEL_KEYS[update.health])}
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
                        className={cn(
                          'rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground-secondary',
                          TOUCH_TARGET,
                        )}
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
