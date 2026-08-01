'use client';

import { FileText, Loader2, Paperclip, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { InlineRetry } from '@/components/shared/inline-retry';
import { useFormatters } from '@/hooks/use-formatters';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import { gqlMutate, gqlQuery } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { getErrorMessage } from '@/lib/utils';

interface Attachment {
  id: string;
  mimeType: string;
  name: string;
  size: number;
  url: string;
}

interface FileAttachmentsProps {
  issueId: string;
}

async function fetchIssueFiles(issueId: string): Promise<Attachment[]> {
  // Throws on a GraphQL error so the `InlineRetry` branch is reachable —
  // returning [] rendered a failed load as "no attachments".
  return gqlQuery<Attachment[]>(
    `query IssueFiles($issueId: ID!) {
        issueFiles(issueId: $issueId) { id name size url mimeType }
      }`,
    { issueId },
    'issueFiles',
  );
}

async function deleteFile(fileId: string): Promise<void> {
  await gqlMutate(
    `mutation FileDelete($id: ID!) {
        fileDelete(id: $id) { success }
      }`,
    { id: fileId },
  );
}

export function FileAttachments({ issueId }: FileAttachmentsProps) {
  const t = useTranslations();
  const { formatFileSize } = useFormatters();
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const {
    data: attachments,
    setData: setAttachments,
    error: loadError,
    refetch: loadAttachments,
  } = useRetryableFetch<Attachment[]>(() => fetchIssueFiles(issueId), [issueId], []);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) {
      return;
    }
    if (inputRef.current) {
      inputRef.current.value = '';
    }

    setUploading(true);
    try {
      const uploaded: Attachment[] = [];
      for (const file of files) {
        const form = new FormData();
        form.append('file', file);
        form.append('issueId', issueId);

        const res = await fetch('/api/upload', { body: form, method: 'POST' });
        if (!res.ok) {
          const err = await res
            .json()
            .catch(() => ({ error: t('issueDetail.attachments.uploadFailed') }));
          toast.error(err.error ?? t('issueDetail.attachments.uploadFailed'));
          continue;
        }
        const data = await res.json();
        uploaded.push(data);
      }
      setAttachments(prev => [...prev, ...uploaded]);
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (att: Attachment) => {
    try {
      await deleteFile(att.id);
      setAttachments(prev => prev.filter(a => a.id !== att.id));
    } catch (err) {
      toast.error(getErrorMessage(err, t('issueDetail.attachments.failedToDelete')));
    }
  };

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium text-muted-foreground">
          {t('issueDetail.attachments.title')}
        </p>
        <button
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground-secondary disabled:opacity-50"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
          type="button"
        >
          {uploading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Paperclip className="h-3 w-3" />
          )}
          {uploading ? t('issueDetail.attachments.uploading') : t('issueDetail.attachments.attach')}
        </button>
      </div>
      <input
        aria-label={t('issueDetail.attachments.attachFile')}
        className="hidden"
        multiple
        onChange={handleFileSelect}
        ref={inputRef}
        type="file"
      />
      {attachments.length > 0 ? (
        <ul className="space-y-1">
          {attachments.map(att => (
            <li
              className="flex items-center gap-2 rounded-md border border-border p-2 text-xs"
              key={att.id}
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <a
                className="flex-1 truncate text-foreground-secondary hover:text-brand"
                href={att.url}
                rel="noopener noreferrer"
                target="_blank"
              >
                {att.name}
              </a>
              <span className="shrink-0 text-muted-foreground">{formatFileSize(att.size)}</span>
              <button
                aria-label={t('issueDetail.attachments.removeAttachment')}
                className="text-muted-foreground hover:text-danger-subtle-foreground max-md:flex max-md:h-11 max-md:min-w-11 max-md:items-center max-md:justify-center"
                onClick={() => handleDelete(att)}
                type="button"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : loadError ? (
        <InlineRetry
          className="py-2"
          message={t('issueDetail.attachments.failedToLoad')}
          onRetry={loadAttachments}
        />
      ) : (
        <p className="text-xs italic text-muted-foreground">{t('issueDetail.attachments.empty')}</p>
      )}
    </div>
  );
}
