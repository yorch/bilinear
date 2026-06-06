'use client';

import { cn } from '@/lib/utils';

export interface UserAvatarUser {
  avatarBackgroundColor: string;
  avatarUrl?: string | null;
  displayName: string;
  initials: string;
}

export function UserAvatar({
  user,
  size = 'sm',
}: {
  user: UserAvatarUser;
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
