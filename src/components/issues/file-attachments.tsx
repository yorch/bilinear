'use client';

import { FileText, Loader2, Paperclip, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from '@/lib/toast';
import { formatFileSize } from '@/lib/utils';

interface Attachment {
  id: string;
  name: string;
  size: number;
  url: string;
  mimeType: string;
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
  if (json.errors?.length) throw new Error(json.errors[0].message);
}

export function FileAttachments({ issueId }: FileAttachmentsProps) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetchIssueFiles(issueId)
      .then(setAttachments)
      .catch(() => {});
  }, [issueId]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    if (inputRef.current) inputRef.current.value = '';

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
            .catch(() => ({ error: 'Upload failed' }));
          toast.error(err.error ?? 'Upload failed');
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
      toast.error(err instanceof Error ? err.message : 'Failed to delete file');
    }
  };

  return (
    <div className="mt-4">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium text-zinc-500">Attachments</p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-700 disabled:opacity-50 dark:hover:text-zinc-300"
        >
          {uploading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Paperclip className="h-3 w-3" />
          )}
          {uploading ? 'Uploading…' : 'Attach'}
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={handleFileSelect}
        aria-label="Attach file"
      />
      {attachments.length > 0 ? (
        <ul className="space-y-1">
          {attachments.map(att => (
            <li
              key={att.id}
              className="flex items-center gap-2 rounded-md border border-zinc-200 p-2 text-xs dark:border-zinc-700"
            >
              <FileText className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
              <a
                href={att.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 truncate text-zinc-700 hover:text-indigo-600 dark:text-zinc-300"
              >
                {att.name}
              </a>
              <span className="shrink-0 text-zinc-400">
                {formatFileSize(att.size)}
              </span>
              <button
                type="button"
                onClick={() => handleDelete(att)}
                className="text-zinc-400 hover:text-red-500"
                aria-label="Remove attachment"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs italic text-zinc-400">No attachments</p>
      )}
    </div>
  );
}
