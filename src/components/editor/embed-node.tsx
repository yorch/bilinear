'use client';

import type { CommandProps } from '@tiptap/core';
import { mergeAttributes, Node } from '@tiptap/core';
import type { NodeViewProps } from '@tiptap/react';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { useState } from 'react';
import { useTranslations } from '@/hooks/use-translations';
import { cn } from '@/lib/utils';

const YOUTUBE_RE = /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
const LOOM_RE = /loom\.com\/(?:share|embed)\/([a-zA-Z0-9]+)/;

function getEmbedUrl(url: string): string | null {
  const yt = YOUTUBE_RE.exec(url);
  if (yt) {
    return `https://www.youtube.com/embed/${yt[1]}`;
  }
  const loom = LOOM_RE.exec(url);
  if (loom) {
    return `https://www.loom.com/embed/${loom[1]}`;
  }
  return null;
}

function EmbedView({ node, updateAttributes, selected }: NodeViewProps) {
  const t = useTranslations();
  const url = (node.attrs.url as string) ?? '';
  const [editing, setEditing] = useState(!url);
  const embedUrl = url ? getEmbedUrl(url) : null;

  const handleSubmit = (value: string) => {
    updateAttributes({ url: value });
    setEditing(false);
  };

  if (editing || !embedUrl) {
    return (
      <NodeViewWrapper>
        <div className="embed-editor my-2 rounded-md border border-zinc-300 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-900">
          <p className="mb-2 text-xs font-medium text-zinc-500">{t('editor.embed.urlLabel')}</p>
          <form
            className="flex gap-2"
            onSubmit={e => {
              e.preventDefault();
              const input = (e.currentTarget.elements[0] as HTMLInputElement).value;
              handleSubmit(input);
            }}
          >
            <input
              className="flex-1 rounded border border-zinc-200 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              defaultValue={url}
              placeholder="https://youtube.com/watch?v=..."
              type="url"
            />
            <button
              className="rounded bg-primary px-2 py-1 text-xs text-white hover:bg-primary/90"
              type="submit"
            >
              {t('editor.embed.submit')}
            </button>
          </form>
          {url && !embedUrl && (
            <p className="mt-1 text-xs text-red-500">{t('editor.embed.unsupportedUrl')}</p>
          )}
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper>
      <div
        className={cn(
          'embed-block group relative my-2 overflow-hidden rounded-md border',
          selected ? 'border-indigo-400' : 'border-border',
        )}
        style={{ paddingBottom: '56.25%' }}
      >
        <iframe
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="absolute inset-0 h-full w-full"
          src={embedUrl}
          title={t('editor.embed.videoTitle')}
        />
        <button
          aria-label={t('editor.embed.editAriaLabel')}
          className="absolute right-2 top-2 z-10 rounded bg-black/50 p-1.5 text-white opacity-0 transition-opacity hover:bg-black/70 group-hover:opacity-100"
          onClick={() => setEditing(true)}
          title={t('editor.embed.editAriaLabel')}
          type="button"
        >
          <svg
            aria-hidden="true"
            fill="none"
            height="12"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="2.5"
            viewBox="0 0 24 24"
            width="12"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        </button>
      </div>
    </NodeViewWrapper>
  );
}

export const EmbedNode = Node.create({
  addAttributes() {
    return {
      url: { default: '' },
    };
  },

  addCommands() {
    return {
      insertEmbed:
        (options: { url: string }) =>
        ({ commands }: CommandProps) =>
          commands.insertContent({
            attrs: { url: options.url },
            type: this.name,
          }),
    } as never;
  },

  addNodeView() {
    return ReactNodeViewRenderer(EmbedView);
  },
  atom: true,
  group: 'block',
  name: 'embed',

  parseHTML() {
    return [{ tag: 'div[data-type="embed"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-type': 'embed',
        'data-url': node.attrs.url,
      }),
    ];
  },
});
