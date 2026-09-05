'use client';

import { isPermissionError } from '@/lib/graphql';
import { getErrorMessage } from '@/lib/utils';
import { InlineRetry } from './inline-retry';

interface LoadErrorProps {
  /** The thrown error (`cause` from `useRetryableFetch`). */
  cause: unknown;
  className?: string;
  /** Localized text for a genuine failure when the error carries no usable message. */
  fallback: string;
  /**
   * Localized text for a refused read. Defaults to `fallback`, but a page that
   * knows why (e.g. "You need admin access to view audit logs.") should say so.
   */
  forbiddenMessage?: string;
  onRetry: () => void;
}

/**
 * The one rendering of "this read could not be completed".
 *
 * A refused read (`FORBIDDEN` / `UNAUTHENTICATED`) is an answer, not a
 * failure: retrying it changes nothing, so it renders as a plain muted line.
 * Everything else gets the retry affordance every other failed load offers.
 * Either way the section's data is NOT rendered, so an unreadable resource
 * can never be mistaken for an absent one — the trap the webhooks page fell
 * into when a 403 read as "no webhooks yet".
 *
 * Check this BEFORE the generic `error` branch of `useRetryableFetch`: a
 * refusal trips `error` too, and without this a non-admin gets a Retry that
 * can never succeed (frontend.md, "Hooks and interaction contracts").
 */
export function LoadError({
  cause,
  className,
  fallback,
  forbiddenMessage,
  onRetry,
}: LoadErrorProps) {
  if (isPermissionError(cause)) {
    return (
      <p className={className ?? 'text-sm text-muted-foreground'}>{forbiddenMessage ?? fallback}</p>
    );
  }
  return (
    <InlineRetry
      className={className}
      message={getErrorMessage(cause, fallback)}
      onRetry={onRetry}
    />
  );
}
