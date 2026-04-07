import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Extract the first error message from a GraphQL response, with a fallback. */
export function gqlError(result: { errors?: unknown[] }, fallback: string): string {
  return (result.errors?.[0] as { message?: string })?.message ?? fallback;
}

/** Extract a human-readable message from an unknown catch value, with a fallback. */
export function getErrorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}
