'use client';

import { UserRound } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { PropertyPlaceholder } from '@/components/properties/property-placeholder';
import { SearchableSelectPopover } from '@/components/ui/searchable-select-popover';
import { UserAvatar } from '@/components/ui/user-avatar';
import { useTranslations } from '@/hooks/use-translations';
import { cn, TOUCH_TARGET } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

interface User {
  avatarBackgroundColor: string;
  avatarUrl?: string | null;
  displayName: string;
  id: string;
  initials: string;
}

interface AssigneeSelectProps {
  className?: string;
  forceOpen?: boolean;
  /** Text shown beside the icon while unassigned. */
  label?: string;
  onChange: (userId: string | null) => void;
  onClose?: () => void;
  users: User[];
  value: string | null | undefined;
}

/** A row in the list: the "unassigned" choice, the "me" shortcut, or a person. */
type AssigneeOption = { kind: 'none' } | { kind: 'me'; user: User } | { kind: 'user'; user: User };

function optionKey(option: AssigneeOption): string {
  return option.kind === 'none' ? 'none' : `${option.kind}-${option.user.id}`;
}

export const AssigneeSelect = observer(function AssigneeSelect({
  value,
  users,
  onChange,
  className,
  forceOpen,
  label,
  onClose,
}: AssigneeSelectProps) {
  const t = useTranslations();
  const { userStore } = useStore();
  const current = users.find(u => u.id === value);
  const me = users.find(u => u.id === userStore.currentUser?.id);
  const noAssignee = t('properties.assignee.noAssignee');
  const assignToMe = t('properties.assignee.assignToMe');

  // "No assignee" and "Assign to me" lead the list; the shortcut disappears once
  // it would be a no-op (the person is still listed below in their own row).
  const options: AssigneeOption[] = [
    { kind: 'none' } as const,
    ...(me && me.id !== value ? [{ kind: 'me', user: me } as const] : []),
    ...users.map(user => ({ kind: 'user', user }) as const),
  ];

  return (
    <SearchableSelectPopover<AssigneeOption>
      align="right"
      className={className}
      emptyText={t('properties.assignee.noUsersFound')}
      forceOpen={forceOpen}
      getKey={optionKey}
      isSelected={option =>
        option.kind === 'none' ? !value : option.kind === 'user' && option.user.id === value
      }
      items={options}
      matchesSearch={(option, search) => {
        const q = search.toLowerCase();
        if (option.kind === 'none') {
          return noAssignee.toLowerCase().includes(q);
        }
        if (option.kind === 'me') {
          return (
            assignToMe.toLowerCase().includes(q) ||
            option.user.displayName.toLowerCase().includes(q)
          );
        }
        return option.user.displayName.toLowerCase().includes(q);
      }}
      onClose={onClose}
      onSelect={option => onChange(option.kind === 'none' ? null : option.user.id)}
      panelClassName="min-w-[220px]"
      renderItem={option =>
        option.kind === 'none' ? (
          <span className="text-muted-foreground">{noAssignee}</span>
        ) : option.kind === 'me' ? (
          <>
            <UserAvatar size="xs" user={option.user} />
            {assignToMe}
          </>
        ) : (
          <>
            <UserAvatar size="xs" user={option.user} />
            {option.user.displayName}
          </>
        )
      }
      searchPlaceholder={t('properties.assignee.searchPlaceholder')}
      triggerChildren={
        current ? (
          <UserAvatar size="xs" user={current} />
        ) : (
          // A dashed ring used to stand in for "unassigned". A dashed circle is
          // the universal spinner silhouette, so every unassigned row looked
          // like it was still loading. A user glyph cannot be misread.
          <PropertyPlaceholder className="h-4 w-4" icon={UserRound} label={label} />
        )
      }
      triggerClassName={cn('px-1 py-1', TOUCH_TARGET)}
      triggerTitle={current?.displayName ?? noAssignee}
    />
  );
});
