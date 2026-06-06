'use client';

import { useEffect, useRef, useState } from 'react';
import { useOutsideClick } from '@/hooks/use-outside-click';
import { cn } from '@/lib/utils';

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

export function UserAvatar({
  user,
  size = 'sm',
}: {
  user: Pick<User, 'initials' | 'avatarUrl' | 'avatarBackgroundColor' | 'displayName'>;
  size?: 'xs' | 'sm' | 'md';
}) {
  const sizeClass =
    size === 'xs'
      ? 'h-4 w-4 text-[8px]'
      : size === 'md'
        ? 'h-6 w-6 text-[10px]'
        : 'h-5 w-5 text-[10px]';
  if (user.avatarUrl) {
    return (
      // biome-ignore lint/performance/noImgElement: avatar URL is external, size unknown at build time
      <img
        alt={user.displayName}
        className={cn('rounded-full object-cover', sizeClass)}
        src={user.avatarUrl}
      />
    );
  }
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full font-semibold text-white',
        sizeClass,
      )}
      style={{ backgroundColor: user.avatarBackgroundColor }}
    >
      {user.initials}
    </span>
  );
}

export function AssigneeSelect({
  value,
  users,
  onChange,
  className,
  forceOpen,
  onClose,
}: AssigneeSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = users.find(u => u.id === value);

  useEffect(() => {
    if (forceOpen) {
      setOpen(true);
    }
  }, [forceOpen]);

  useOutsideClick(
    ref,
    () => {
      setOpen(false);
      onClose?.();
    },
    open,
  );

  return (
    <div className={cn('relative', className)} ref={ref}>
      <button
        className="flex items-center rounded px-1 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        onClick={e => {
          e.stopPropagation();
          setOpen(o => !o);
        }}
        title={current?.displayName ?? 'No assignee'}
        type="button"
      >
        {current ? (
          <UserAvatar size="xs" user={current} />
        ) : (
          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border-2 border-dashed border-zinc-300 dark:border-zinc-600" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[200px] rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <button
            className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800"
            onClick={e => {
              e.stopPropagation();
              onChange(null);
              setOpen(false);
              onClose?.();
            }}
            type="button"
          >
            No assignee
          </button>
          {users.map(user => (
            <button
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800',
                user.id === value && 'font-medium',
              )}
              key={user.id}
              onClick={e => {
                e.stopPropagation();
                onChange(user.id);
                setOpen(false);
                onClose?.();
              }}
              type="button"
            >
              <UserAvatar size="xs" user={user} />
              {user.displayName}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
