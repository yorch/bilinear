'use client';

import { FileText, Loader2, Paperclip, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { InlineRetry } from '@/components/shared/inline-retry';
import { useFormatters } from '@/hooks/use-formatters';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
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
  const res = await fetch('/api/graphql', {
    body: JSON.stringify({
      query: `query IssueFiles($issueId: ID!) {
        issueFiles(issueId: $issueId) { id name size url mimeType }
      }`,
      variables: { issueId },
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  const json = await res.json();
  return json.data?.issueFiles ?? [];
}

async function deleteFile(fileId: string): Promise<void> {
  const res = await fetch('/api/graphql', {
    body: JSON.stringify({
      query: `mutation FileDelete($id: ID!) {
        fileDelete(id: $id) { success }
      }`,
      variables: { id: fileId },
    }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(json.errors[0].message);
  }
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
        <p className="text-xs font-medium text-zinc-500">{t('issueDetail.attachments.title')}</p>
        <button
          className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-700 disabled:opacity-50 dark:hover:text-zinc-300"
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
              className="flex items-center gap-2 rounded-md border border-zinc-200 p-2 text-xs dark:border-zinc-700"
              key={att.id}
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
              <a
                className="flex-1 truncate text-zinc-700 hover:text-indigo-600 dark:text-zinc-300"
                href={att.url}
                rel="noopener noreferrer"
                target="_blank"
              >
                {att.name}
              </a>
              <span className="shrink-0 text-zinc-400">{formatFileSize(att.size)}</span>
              <button
                aria-label={t('issueDetail.attachments.removeAttachment')}
                className="text-zinc-400 hover:text-red-500"
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
        <p className="text-xs italic text-zinc-400">{t('issueDetail.attachments.empty')}</p>
      )}
    </div>
  );
}
