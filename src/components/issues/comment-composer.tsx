'use client';

import { useRef, useState } from 'react';
import type { MentionItem } from '@/components/editor/mention-list';
import { TipTapEditor } from '@/components/editor/tiptap-editor.lazy';
import { useTranslations } from '@/hooks/use-translations';
import { cn } from '@/lib/utils';

export function CommentComposer({
  placeholder,
  onSubmit,
  submitting,
  value,
  onChange,
  mentionIssues,
  mentionUsers,
  compact = false,
  issueId,
}: {
  placeholder: string;
  onSubmit: (body: string) => void;
  submitting: boolean;
  value: string;
  onChange: (v: string) => void;
  mentionIssues?: MentionItem[];
  mentionUsers?: MentionItem[];
  compact?: boolean;
  issueId?: string;
}) {
  const t = useTranslations();
  const isEmpty = !value || value === '<p></p>' || value.trim() === '';
  const containerRef = useRef<HTMLDivElement>(null);
  /**
   * The composer starts as a single line and grows on first interaction.
   *
   * It used to render a permanently-open fifteen-button formatting toolbar
   * above an 80px box, so the heaviest control on the issue page was the one
   * for a throwaway "looks good to me". Focus is the signal that the toolbar
   * is wanted; content keeps it open across an accidental blur.
   */
  const [focused, setFocused] = useState(false);
  const expanded = !compact && (focused || !isEmpty);
  // `compact` (the reply composer) never had a toolbar and must keep its submit
  // button unconditionally — it is already a deliberate, opened-on-demand form,
  // so hiding its only action would strand the reply.
  const showSubmit = compact || expanded;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: focus/blur only, used to observe whether focus is anywhere inside the composer. The interactive element is the editor's own contenteditable; adding a role here would misdescribe a plain container.
    <div
      className={cn('rounded-lg border border-border transition-colors', expanded ? 'p-3' : 'p-2')}
      onBlur={e => {
        // Only collapse when focus actually leaves the composer — otherwise
        // reaching for the Comment button would fold the editor mid-click.
        if (!containerRef.current?.contains(e.relatedTarget as Node | null)) {
          setFocused(false);
        }
      }}
      onFocus={() => setFocused(true)}
      ref={containerRef}
    >
      <TipTapEditor
        className={cn('text-sm', expanded ? 'min-h-[80px]' : 'min-h-[40px]')}
        content={value}
        mentionIssues={mentionIssues}
        mentionUsers={mentionUsers}
        onChange={onChange}
        placeholder={placeholder}
        showToolbar={expanded}
        uploadIssueId={issueId}
      />
      {/* The submit button appears with the toolbar: a disabled button under an
          untouched one-line field is pure furniture. */}
      {showSubmit && (
        <div className="mt-2 flex justify-end">
          <button
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors',
              'bg-primary hover:bg-primary/90',
              'disabled:cursor-not-allowed disabled:opacity-40',
            )}
            disabled={isEmpty || submitting}
            onClick={() => onSubmit(value)}
            type="button"
          >
            {submitting
              ? t('issueDetail.comments.posting')
              : t('issueDetail.comments.commentButton')}
          </button>
        </div>
      )}
    </div>
  );
}
