'use client';

import { useTranslations } from '@/hooks/use-translations';
import { cn } from '@/lib/utils';
import type { MentionItem } from '../editor/mention-list';
import { TipTapEditor } from '../editor/tiptap-editor.lazy';

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

  return (
    <div className={cn('rounded-lg border border-border', compact ? 'p-2' : 'p-3')}>
      <TipTapEditor
        className={cn('text-sm', compact ? 'min-h-[40px]' : 'min-h-[80px]')}
        content={value}
        mentionIssues={mentionIssues}
        mentionUsers={mentionUsers}
        onChange={onChange}
        placeholder={placeholder}
        showToolbar={!compact}
        uploadIssueId={issueId}
      />
      <div className="mt-2 flex justify-end">
        <button
          className={cn(
            'rounded-md px-3 py-1.5 text-xs font-medium text-white transition-colors',
            'bg-primary hover:bg-primary/90',
            'disabled:cursor-not-allowed disabled:opacity-40',
          )}
          disabled={isEmpty || submitting}
          onClick={() => onSubmit(value)}
          type="button"
        >
          {submitting ? t('issueDetail.comments.posting') : t('issueDetail.comments.commentButton')}
        </button>
      </div>
    </div>
  );
}
