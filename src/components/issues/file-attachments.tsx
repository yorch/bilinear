'use client';

import { FileText, Paperclip, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { formatFileSize } from '@/lib/utils';

interface Attachment {
  id: string;
  name: string;
  size: number;
  url: string;
  type: string;
}

interface FileAttachmentsProps {
  issueId: string;
}

export function FileAttachments({ issueId: _issueId }: FileAttachmentsProps) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    for (const file of files) {
      const reader = new FileReader();
      reader.onload = ev => {
        setAttachments(prev => [
          ...prev,
          {
            id: `${file.name}-${file.size}-${Date.now()}`,
            name: file.name,
            size: file.size,
            type: file.type,
            url: ev.target?.result as string,
          },
        ]);
      };
      reader.readAsDataURL(file);
    }
    if (inputRef.current) {
      inputRef.current.value = '';
    }
  };

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-zinc-500">Attachments</p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-300"
        >
          <Paperclip className="h-3 w-3" />
          Attach
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
              <FileText className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
              <a
                href={att.url}
                download={att.name}
                className="flex-1 truncate text-zinc-700 hover:text-indigo-600 dark:text-zinc-300"
              >
                {att.name}
              </a>
              <span className="text-zinc-400 shrink-0">
                {formatFileSize(att.size)}
              </span>
              <button
                type="button"
                onClick={() =>
                  setAttachments(prev => prev.filter(a => a.id !== att.id))
                }
                className="text-zinc-400 hover:text-red-500"
                aria-label="Remove attachment"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-zinc-400 italic">No attachments</p>
      )}
    </div>
  );
}
