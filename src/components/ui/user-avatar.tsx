'use client';

import { cn } from '@/lib/utils';

export interface UserAvatarUser {
  avatarBackgroundColor: string;
  avatarUrl?: string | null;
  displayName: string;
  initials: string;
}

/*
 * Initials are 8–10px, so they need the full 4.5:1, and the swatch is per-user
 * data (`avatarBgColor`, any hex). No single ink works for every swatch: white
 * on the emerald seed is 2.5:1, and white on the indigo default tops out at
 * 4.47:1 even with pure white, so a mid-tone swatch can clear neither ink as-is.
 * The rule is:
 *
 * - light swatches take the dark ink;
 * - the band in between is darkened until the light ink clears 4.5:1, so the
 *   colour keeps its hue and only loses lightness;
 * - dark swatches take the light ink.
 *
 * The luminance thresholds are derived from the two ink tokens in globals.css
 * (`--avatar-ink-light` / `--avatar-ink-dark`). contrast.test.ts resolves the
 * real tokens and fails if a threshold drifts.
 */
const AVATAR_INK_LIGHT = 'var(--avatar-ink-light)';
const AVATAR_INK_DARK = 'var(--avatar-ink-dark)';

/** Relative luminance at or below which the light ink clears 4.5:1. */
const LIGHT_INK_MAX_LUMINANCE = 0.17;
/** Relative luminance at or above which the dark ink clears 4.5:1. */
const DARK_INK_MIN_LUMINANCE = 0.19;

type Rgb = [number, number, number];

function parseHex(hex: string): Rgb | null {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) {
    return null;
  }
  const value = match[1];
  return [0, 2, 4].map(i => Number.parseInt(value.slice(i, i + 2), 16)) as Rgb;
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map(c => c.toString(16).padStart(2, '0')).join('')}`;
}

function relativeLuminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map(c => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * The swatch to paint and the ink for its initials. `background` is a hex when
 * the input parsed, and the `--avatar-fallback` token otherwise.
 */
export function avatarPresentation(hex: string): { background: string; ink: string } {
  const parsed = parseHex(hex);
  if (!parsed) {
    return { background: 'var(--avatar-fallback)', ink: AVATAR_INK_DARK };
  }
  if (relativeLuminance(parsed) >= DARK_INK_MIN_LUMINANCE) {
    return { background: toHex(parsed), ink: AVATAR_INK_DARK };
  }
  let rgb = parsed;
  // Each step scales every channel down, so this terminates: channels reach 0
  // long before the loop can stall.
  while (relativeLuminance(rgb) > LIGHT_INK_MAX_LUMINANCE) {
    rgb = rgb.map(c => Math.floor(c * 0.97)) as Rgb;
  }
  return { background: toHex(rgb), ink: AVATAR_INK_LIGHT };
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
  const { background, ink } = avatarPresentation(user.avatarBackgroundColor);
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full font-semibold',
        sizeClass,
      )}
      style={{ backgroundColor: background, color: ink }}
    >
      {user.initials}
    </span>
  );
}
