'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

interface User {
  id: string;
  displayName: string;
  initials: string;
  avatarUrl?: string | null;
  avatarBackgroundColor: string;
}

interface AssigneeSelectProps {
  value: string | null | undefined;
  users: User[];
  onChange: (userId: string | null) => void;
  className?: string;
  forceOpen?: boolean;
  onClose?: () => void;
}

export function UserAvatar({
  user,
  size = 'sm',
}: {
  user: Pick<
    User,
    'initials' | 'avatarUrl' | 'avatarBackgroundColor' | 'displayName'
  >;
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
        src={user.avatarUrl}
        alt={user.displayName}
        className={cn('rounded-full object-cover', sizeClass)}
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

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        onClose?.();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div ref={ref} className={cn('relative', className)}>
      <button
        type="button"
        onClick={e => {
          e.stopPropagation();
          setOpen(o => !o);
        }}
        className="flex items-center rounded px-1 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-800"
        title={current?.displayName ?? 'No assignee'}
      >
        {current ? (
          <UserAvatar user={current} size="xs" />
        ) : (
          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full border-2 border-dashed border-zinc-300 dark:border-zinc-600" />
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-[200px] rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
          <button
            type="button"
            onClick={e => {
              e.stopPropagation();
              onChange(null);
              setOpen(false);
              onClose?.();
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-zinc-500 hover:bg-zinc-50 dark:hover:bg-zinc-800"
          >
            No assignee
          </button>
          {users.map(user => (
            <button
              key={user.id}
              type="button"
              onClick={e => {
                e.stopPropagation();
                onChange(user.id);
                setOpen(false);
                onClose?.();
              }}
              className={cn(
                'flex w-full items-center gap-2 px-3 py-1.5 text-sm hover:bg-zinc-50 dark:hover:bg-zinc-800',
                user.id === value && 'font-medium',
              )}
            >
              <UserAvatar user={user} size="xs" />
              {user.displayName}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
