'use client';

import { Plus, Tag } from 'lucide-react';
import { PropertyPlaceholder } from '@/components/properties/property-placeholder';
import { resolveCssVar } from '@/components/teams/color-swatch-picker';
import { ColorDot } from '@/components/ui/color-dot';
import { SearchableSelectPopover } from '@/components/ui/searchable-select-popover';
import { useTranslations } from '@/hooks/use-translations';
import type { DBIssueLabel } from '@/lib/db';
import { gqlMutate } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { cn, getErrorMessage, TOUCH_TARGET } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

interface IssueLabel {
  color: string;
  id: string;
  name: string;
}

interface LabelSelectProps {
  className?: string;
  forceOpen?: boolean;
  /** Text shown beside the icon while no label is set. */
  label?: string;
  labels: IssueLabel[];
  onChange: (labelIds: string[]) => void;
  onClose?: () => void;
  /**
   * Render the selected labels' names in the trigger itself (the detail view),
   * instead of a bare dot cluster that a second list of chips has to repeat.
   */
  showNames?: boolean;
  /**
   * When set, typing a name no label matches offers "Create label" in this
   * team. Omitted by surfaces that only pick from existing labels.
   */
  teamId?: string;
  value: string[];
}

const LABEL_CREATE_MUTATION = `
  mutation IssueLabelCreate($input: IssueLabelCreateInput!) {
    issueLabelCreate(input: $input) {
      success lastSyncId
      issueLabel { id name color description isGroup organizationId teamId parentId createdAt updatedAt archivedAt }
    }
  }
`;

export function LabelDot({ color, className }: { color: string; className?: string }) {
  return <ColorDot className={className} color={color} size="sm" />;
}

export function LabelSelect({
  value,
  labels,
  onChange,
  className,
  forceOpen,
  label,
  onClose,
  showNames,
  teamId,
}: LabelSelectProps) {
  const t = useTranslations();
  const selected = labels.filter(l => value.includes(l.id));

  const toggle = (labelId: string) => {
    const next = value.includes(labelId) ? value.filter(id => id !== labelId) : [...value, labelId];
    onChange(next);
  };

  return (
    <SearchableSelectPopover<IssueLabel>
      align="right"
      className={className}
      closeOnSelect={false}
      emptyText={t('properties.label.noLabelsFound')}
      footer={
        teamId
          ? ({ search }) => (
              <CreateLabelRow
                existing={labels}
                name={search.trim()}
                onCreated={id => onChange([...value, id])}
                teamId={teamId}
              />
            )
          : undefined
      }
      forceOpen={forceOpen}
      getKey={label => label.id}
      isSelected={label => value.includes(label.id)}
      items={labels}
      matchesSearch={(label, search) => label.name.toLowerCase().includes(search.toLowerCase())}
      multiple
      onClose={onClose}
      onSelect={label => toggle(label.id)}
      panelClassName="min-w-[220px]"
      renderItem={label => (
        <>
          <LabelDot color={label.color} />
          <span className="min-w-0 flex-1 truncate text-left">{label.name}</span>
          {value.includes(label.id) && <span className="text-muted-foreground">✓</span>}
        </>
      )}
      searchPlaceholder={t('properties.label.searchPlaceholder')}
      triggerChildren={
        selected.length === 0 ? (
          <PropertyPlaceholder icon={Tag} label={label} />
        ) : showNames ? (
          selected.map(l => (
            <span
              className="flex min-w-0 items-center gap-1 text-xs text-foreground-secondary"
              key={l.id}
            >
              <LabelDot className="shrink-0" color={l.color} />
              <span className="truncate">{l.name}</span>
            </span>
          ))
        ) : (
          selected.slice(0, 3).map(l => <LabelDot color={l.color} key={l.id} />)
        )
      }
      triggerClassName={cn(
        'px-1.5 py-1',
        showNames ? 'flex-wrap gap-x-2 gap-y-0.5' : 'gap-0.5',
        TOUCH_TARGET,
        'max-md:justify-start',
      )}
      triggerTitle={
        selected.length ? selected.map(l => l.name).join(', ') : t('properties.label.noLabels')
      }
    />
  );
}

/**
 * "Create label “x”" under the list. Reads the store only here, so a plain
 * label picker (no `teamId`) never needs the provider.
 */
function CreateLabelRow({
  existing,
  name,
  onCreated,
  teamId,
}: {
  existing: IssueLabel[];
  name: string;
  onCreated: (labelId: string) => void;
  teamId: string;
}) {
  const t = useTranslations();
  const { labelStore } = useStore();

  if (!name || existing.some(l => l.name.toLowerCase() === name.toLowerCase())) {
    return null;
  }

  const create = async () => {
    try {
      const data = await gqlMutate(LABEL_CREATE_MUTATION, {
        input: {
          color: resolveCssVar('--entity-swatch-1') ?? 'var(--entity-swatch-1)',
          name,
          teamId,
        },
      });
      const created = (data.issueLabelCreate as { issueLabel?: DBIssueLabel }).issueLabel;
      if (created) {
        labelStore.applySyncAction('I', created.id, created);
        onCreated(created.id);
      }
    } catch (err) {
      toast.error(getErrorMessage(err, t('properties.label.createFailed')));
    }
  };

  return (
    <button
      className={cn(
        'mt-1 flex w-full items-center gap-2 rounded-md border-t border-border px-2 py-1.5 text-xs text-foreground hover:bg-accent',
        TOUCH_TARGET,
        'max-md:justify-start',
      )}
      onClick={() => void create()}
      type="button"
    >
      <Plus className="h-3 w-3 shrink-0" />
      <span className="truncate">{t('properties.label.createLabel', { name })}</span>
    </button>
  );
}
