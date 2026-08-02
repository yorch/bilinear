'use client';

import { SelectPopover } from '@/components/ui/select-popover';
import { useTranslations } from '@/hooks/use-translations';
import { cn } from '@/lib/utils';
import { UserAvatar } from '../ui/user-avatar';

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
  onChange: (userId: string | null) => void;
  onClose?: () => void;
  users: User[];
  value: string | null | undefined;
}

export function AssigneeSelect({
  value,
  users,
  onChange,
  className,
  forceOpen,
  onClose,
}: AssigneeSelectProps) {
  const t = useTranslations();
  const current = users.find(u => u.id === value);

  return (
    <SelectPopover
      align="right"
      className={className}
      forceOpen={forceOpen}
      listbox
      onClose={onClose}
      panelClassName="min-w-[200px] py-1"
      triggerChildren={
        current ? (
          <UserAvatar size="xs" user={current} />
        ) : (
          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border-2 border-dashed border-border" />
        )
      }
      triggerClassName="px-1 py-1 max-md:flex max-md:h-11 max-md:min-w-11 max-md:items-center max-md:justify-center"
      triggerTitle={current?.displayName ?? t('properties.assignee.noAssignee')}
    >
      {close => (
        <>
          <button
            aria-selected={value === null || value === undefined}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent"
            onClick={e => {
              e.stopPropagation();
              onChange(null);
              close();
            }}
            role="option"
            type="button"
          >
            {t('properties.assignee.noAssignee')}
          </button>
          {users.map(user => (
            <button
              aria-selected={user.id === value}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent',
                user.id === value && 'font-medium',
              )}
              key={user.id}
              onClick={e => {
                e.stopPropagation();
                onChange(user.id);
                close();
              }}
              role="option"
              type="button"
            >
              <UserAvatar size="xs" user={user} />
              {user.displayName}
            </button>
          ))}
        </>
      )}
    </SelectPopover>
  );
}
