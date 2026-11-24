'use client';

import { ArrowLeft, Flag } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { InitiativeUpdatesSection } from '@/components/initiatives/initiative-updates-section';
import { useInitiativeUpdate } from '@/components/initiatives/use-initiative-update';
import { AssigneeSelect } from '@/components/properties/assignee-select';
import { DueDatePicker } from '@/components/properties/due-date-picker';
import { SectionCard } from '@/components/shared/section-card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { SimpleSelect } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useTranslations } from '@/hooks/use-translations';
import { toIssueUsers } from '@/lib/issue-mappers';
import { cn, TOUCH_TARGET_SQUARE } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

const STATUSES = ['planned', 'active', 'completed', 'canceled'] as const;
const NO_PARENT = '';

/**
 * One initiative with every field editable in place: name, description, owner,
 * target date, parent and status. Each edit goes through `useInitiativeUpdate`
 * (optimistic, rolled back with a toast on refusal), so the page never claims a
 * change the server did not make. The parent picker only offers initiatives
 * that cannot form a cycle — the server refuses the rest.
 */
export const InitiativeDetail = observer(function InitiativeDetail({
  initiativeId,
  workspace,
}: {
  initiativeId: string;
  workspace: string;
}) {
  const t = useTranslations();
  const { initiativeStore, userStore } = useStore();
  const update = useInitiativeUpdate();
  const initiative = initiativeStore.findById(initiativeId);
  useDocumentTitle(initiative?.name);

  const [name, setName] = useState(initiative?.name ?? '');
  const [description, setDescription] = useState(initiative?.description ?? '');
  // Re-seed when the row changes underneath us (a sync action or a rollback);
  // typing is not interrupted because these only fire on the stored value.
  const storedName = initiative?.name;
  const storedDescription = initiative?.description;
  useEffect(() => setName(storedName ?? ''), [storedName]);
  useEffect(() => setDescription(storedDescription ?? ''), [storedDescription]);

  if (!initiative || initiative.archivedAt) {
    return (
      <EmptyState
        className="flex-1"
        icon={<Flag className="h-5 w-5" />}
        title={t('initiatives.detail.notFound')}
      />
    );
  }

  const rowClass = 'grid grid-cols-3 items-center gap-2 py-1.5';
  const labelClass = 'text-xs text-muted-foreground';
  const owner = initiative.ownerId ? userStore.findById(initiative.ownerId) : null;
  const parentOptions = [
    { label: t('initiatives.detail.noParent'), value: NO_PARENT },
    ...initiativeStore
      .getParentCandidates(initiative.id)
      .map(i => ({ label: i.name, value: i.id })),
  ];

  const commitName = () => {
    const next = name.trim();
    if (!next) {
      setName(initiative.name);
      return;
    }
    if (next !== initiative.name) {
      void update(initiative.id, { name: next });
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <PageHeader
        leading={
          <Link
            aria-label={t('initiatives.detail.back')}
            className={cn(
              'flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground-secondary',
              TOUCH_TARGET_SQUARE,
            )}
            href={`/${workspace}/initiatives`}
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
        }
        title={initiative.name}
      />
      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl px-6 py-6">
          <Input
            aria-label={t('initiatives.page.namePlaceholder')}
            className="text-base font-semibold"
            onBlur={commitName}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.currentTarget.blur();
              } else if (e.key === 'Escape') {
                setName(initiative.name);
                e.currentTarget.blur();
              }
            }}
            value={name}
          />
          <Textarea
            aria-label={t('initiatives.detail.description')}
            className="mt-3 min-h-24"
            onBlur={() => {
              if (description !== (initiative.description ?? '')) {
                void update(initiative.id, { description });
              }
            }}
            onChange={e => setDescription(e.target.value)}
            placeholder={t('initiatives.detail.descriptionPlaceholder')}
            value={description}
          />
          <SectionCard className="mt-6" title={t('initiatives.detail.properties')}>
            <div className={rowClass}>
              <span className={labelClass}>{t('initiatives.detail.status')}</span>
              <div className="col-span-2">
                <SimpleSelect
                  ariaLabel={t('initiatives.detail.status')}
                  onChange={status => void update(initiative.id, { status })}
                  options={STATUSES.map(s => ({ label: t(`initiatives.status.${s}`), value: s }))}
                  value={initiative.status}
                  variant="ghost"
                />
              </div>
            </div>
            <div className={rowClass}>
              <span className={labelClass}>{t('initiatives.detail.owner')}</span>
              <div className="col-span-2 flex items-center gap-1">
                <AssigneeSelect
                  onChange={ownerId => void update(initiative.id, { ownerId })}
                  users={toIssueUsers(userStore.all.filter(u => u.active))}
                  value={initiative.ownerId}
                />
                <span className="text-sm text-foreground-secondary">
                  {owner?.displayName ?? t('initiatives.detail.noOwner')}
                </span>
              </div>
            </div>
            <div className={rowClass}>
              <span className={labelClass}>{t('initiatives.detail.targetDate')}</span>
              <div className="col-span-2">
                <DueDatePicker
                  label={t('properties.dueDate.setDate')}
                  onChange={targetDate => void update(initiative.id, { targetDate })}
                  value={initiative.targetDate}
                />
              </div>
            </div>
            <div className={rowClass}>
              <span className={labelClass}>{t('initiatives.detail.parent')}</span>
              <div className="col-span-2">
                <SimpleSelect
                  ariaLabel={t('initiatives.detail.parent')}
                  onChange={parentId => void update(initiative.id, { parentId: parentId || null })}
                  options={parentOptions}
                  value={initiative.parentId ?? NO_PARENT}
                  variant="ghost"
                />
              </div>
            </div>
          </SectionCard>
          <div className="mt-6">
            <InitiativeUpdatesSection
              initiativeId={initiative.id}
              viewerId={userStore.currentUserId ?? ''}
            />
          </div>
        </div>
      </div>
    </div>
  );
});
