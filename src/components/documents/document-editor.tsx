'use client';

import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { TipTapEditor } from '@/components/editor/tiptap-editor';
import { TransactionQueue } from '@/lib/transaction-queue';
import { useStore } from '@/providers/store-provider';

interface DocumentEditorProps {
  documentId: string;
}

export const DocumentEditor = observer(function DocumentEditor({
  documentId,
}: DocumentEditorProps) {
  const { documentStore } = useStore();
  const txQueue = useMemo(() => new TransactionQueue(), []);

  const doc = documentStore.findById(documentId);

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleContentChange = useCallback(
    (html: string) => {
      if (!doc) {
        return;
      }

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = setTimeout(() => {
        txQueue.enqueue(
          `mutation DocumentUpdate($id: ID!, $input: DocumentUpdateInput!) {
            documentUpdate(id: $id, input: $input) {
              success
              lastSyncId
              document { id title content updatedAt }
            }
          }`,
          { id: documentId, input: { content: html } },
          {},
        );
      }, 1000);
    },
    [doc, documentId, txQueue],
  );

  const handleTitleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const title = e.target.value;

      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }

      saveTimeoutRef.current = setTimeout(() => {
        txQueue.enqueue(
          `mutation DocumentUpdate($id: ID!, $input: DocumentUpdateInput!) {
            documentUpdate(id: $id, input: $input) {
              success
              lastSyncId
              document { id title content updatedAt }
            }
          }`,
          { id: documentId, input: { title } },
          {},
        );
      }, 1000);
    },
    [documentId, txQueue],
  );

  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  if (!doc) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-zinc-400">
        Document not found.
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <div className="border-b border-zinc-200 px-8 py-4 dark:border-zinc-800">
        <input
          type="text"
          defaultValue={doc.title}
          onChange={handleTitleChange}
          placeholder="Untitled"
          className="w-full bg-transparent text-2xl font-bold text-zinc-900 placeholder-zinc-300 outline-none dark:text-zinc-100 dark:placeholder-zinc-600"
        />
      </div>
      <div className="flex-1 overflow-y-auto px-8 py-4">
        <TipTapEditor
          content={doc.content ?? ''}
          onChange={handleContentChange}
          placeholder="Start writing..."
          showToolbar
        />
      </div>
    </div>
  );
});
