'use client';

import { ArrowLeft, Bell, BellOff } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useState } from 'react';
import { useHotkeys } from '@/hooks/use-hotkeys';
import { useTranslations } from '@/hooks/use-translations';
import { gql } from '@/lib/graphql';
import {
  ISSUE_SUBSCRIBE_MUTATION,
  ISSUE_SUBSCRIPTION_QUERY,
  ISSUE_UNSUBSCRIBE_MUTATION,
} from '@/lib/graphql-queries';
import { toast } from '@/lib/toast';
import { cn, TOUCH_TARGET } from '@/lib/utils';
import type { IssueDetail, IssueLabel, IssueUser, WorkflowState } from '@/types/issues';
import { IssueDetailContent } from './issue-detail-content';

interface IssueDetailPanelProps {
  breadcrumb?: { label: string; onNavigate: () => void } | null;
  issue: IssueDetail | null;
  labels: IssueLabel[];
  onClose: () => void;
  onUpdate: (id: string, patch: Record<string, unknown>) => void;
  states: WorkflowState[];
  users: IssueUser[];
}

/**
 * Subscription state plus its optimistic toggle, shared by the overlay panel and
 * the full-page header.
 */
export function useIssueSubscription(issueId: string | undefined) {
  const t = useTranslations();
  // null = still loading, true = subscribed, false = not subscribed
  const [subscribed, setSubscribed] = useState<boolean | null>(null);

  useEffect(() => {
    if (!issueId) {
      return;
    }
    setSubscribed(null);
    gql(ISSUE_SUBSCRIPTION_QUERY, { issueId })
      .then(res => {
        if (res.errors?.length) {
          setSubscribed(false);
          return;
        }
        const val = res.data?.notificationIsSubscribed;
        setSubscribed(typeof val === 'boolean' ? val : false);
      })
      .catch(() => setSubscribed(false));
  }, [issueId]);

  const toggle = useCallback(async () => {
    if (!issueId || subscribed === null) {
      return;
    }
    const prev = subscribed;
    setSubscribed(!prev);
    try {
      const mutation = prev ? ISSUE_UNSUBSCRIBE_MUTATION : ISSUE_SUBSCRIBE_MUTATION;
      const res = await gql(mutation, { issueId });
      if (res.errors?.length) {
        setSubscribed(prev);
        toast.error(
          prev ? t('issueDetail.failedToUnsubscribe') : t('issueDetail.failedToSubscribe'),
        );
      }
    } catch {
      setSubscribed(prev);
      toast.error(prev ? t('issueDetail.failedToUnsubscribe') : t('issueDetail.failedToSubscribe'));
    }
  }, [issueId, subscribed, t]);

  return { subscribed, toggle };
}

/** The bell that subscribes/unsubscribes, or nothing while the state loads. */
export function SubscribeButton({
  onToggle,
  subscribed,
}: {
  onToggle: () => void;
  subscribed: boolean | null;
}) {
  const t = useTranslations();
  if (subscribed === null) {
    return null;
  }
  const label = subscribed
    ? t('issueDetail.unsubscribeShortcut')
    : t('issueDetail.subscribeShortcut');
  return (
    <button
      aria-label={label}
      className={cn('rounded p-1 text-muted-foreground hover:bg-accent', TOUCH_TARGET)}
      onClick={onToggle}
      title={label}
      type="button"
    >
      {subscribed ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
    </button>
  );
}

/**
 * Is the event target a text-entry surface the user is mid-edit in?
 *
 * Escape closes the panel, but the title field and the description editor both
 * use Escape to *cancel their own edit* — and neither calls
 * `preventDefault()`, because the title's handler predates this listener and
 * TipTap does not handle Escape at all. So Escape in either one discarded the
 * edit and then threw the whole panel away, losing the reader's place. A
 * contenteditable check covers the editor; `tagName` covers the input.
 */
function isEditingText(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) {
    return false;
  }
  return (
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.isContentEditable === true ||
    el.closest?.('[contenteditable="true"]') != null
  );
}

/**
 * The issue detail as an OVERLAY, opened from a list or board.
 *
 * This component is only the overlay chrome — backdrop, fixed sheet, header,
 * Escape-to-close. Everything inside it is `IssueDetailContent`, which the
 * `/issue/[id]` route renders in its `page` layout instead. Before the split
 * this component *was* the whole feature, so the route mounted a 480px sheet
 * over an empty canvas.
 */
export const IssueDetailPanel = observer(function IssueDetailPanel({
  breadcrumb,
  issue,
  states,
  users,
  labels,
  onClose,
  onUpdate,
}: IssueDetailPanelProps) {
  const t = useTranslations();
  const { subscribed, toggle } = useIssueSubscription(issue?.id);

  useHotkeys('shift+s', toggle, {}, [subscribed, issue?.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !isEditingText(e.target)) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!issue) {
    return null;
  }

  return (
    <>
      {/* Backdrop */}
      <div aria-hidden="true" className="fixed inset-0 z-30" onClick={onClose} />

      {/* Panel — full-screen sheet below md (no room for a side panel on a
          phone-width viewport); the fixed 480px side panel returns at md+. */}
      <div
        className="fixed inset-0 z-40 flex h-full w-full flex-col border-l border-border bg-card shadow-e3 md:inset-y-0 md:right-0 md:left-auto md:w-[480px]"
        data-testid="issue-detail-panel"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex min-w-0 items-center gap-1.5">
            {breadcrumb && (
              <>
                <button
                  className="flex items-center gap-1 truncate text-xs text-muted-foreground hover:text-foreground"
                  onClick={breadcrumb.onNavigate}
                  type="button"
                >
                  <ArrowLeft className="h-3 w-3 shrink-0" />
                  <span className="truncate">{breadcrumb.label}</span>
                </button>
                <span className="text-muted-foreground">/</span>
              </>
            )}
            <span className="font-mono text-xs text-muted-foreground">{issue.identifier}</span>
          </div>
          <div className="flex items-center gap-1">
            <SubscribeButton onToggle={toggle} subscribed={subscribed} />
            <button
              aria-label={t('common.close')}
              className={cn('rounded p-1 text-muted-foreground hover:bg-accent', TOUCH_TARGET)}
              onClick={onClose}
              type="button"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto">
          <IssueDetailContent
            issue={issue}
            labels={labels}
            layout="panel"
            onUpdate={onUpdate}
            states={states}
            users={users}
          />
        </div>
      </div>
    </>
  );
});
