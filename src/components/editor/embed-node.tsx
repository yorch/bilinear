'use client';

import type { CommandProps } from '@tiptap/core';
import { mergeAttributes, Node } from '@tiptap/core';
import type { NodeViewProps } from '@tiptap/react';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { useState } from 'react';

const YOUTUBE_RE =
  /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/;
const LOOM_RE = /loom\.com\/(?:share|embed)\/([a-zA-Z0-9]+)/;

function getEmbedUrl(url: string): string | null {
  const yt = YOUTUBE_RE.exec(url);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const loom = LOOM_RE.exec(url);
  if (loom) return `https://www.loom.com/embed/${loom[1]}`;
  return null;
}

function EmbedView({ node, updateAttributes, selected }: NodeViewProps) {
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
          <p className="mb-2 text-xs font-medium text-zinc-500">
            Embed URL (YouTube or Loom)
          </p>
          <form
            onSubmit={e => {
              e.preventDefault();
              const input = (e.currentTarget.elements[0] as HTMLInputElement)
                .value;
              handleSubmit(input);
            }}
            className="flex gap-2"
          >
            <input
              type="url"
              className="flex-1 rounded border border-zinc-200 bg-white px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
              placeholder="https://youtube.com/watch?v=..."
              defaultValue={url}
              autoFocus
            />
            <button
              type="submit"
              className="rounded bg-indigo-600 px-2 py-1 text-xs text-white hover:bg-indigo-700"
            >
              Embed
            </button>
          </form>
          {url && !embedUrl && (
            <p className="mt-1 text-xs text-red-500">
              Unsupported URL — paste a YouTube or Loom link
            </p>
          )}
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper>
      <div
        className={`embed-block relative my-2 overflow-hidden rounded-md border ${
          selected
            ? 'border-indigo-400'
            : 'border-zinc-200 dark:border-zinc-700'
        }`}
        style={{ paddingBottom: '56.25%' }}
      >
        <iframe
          src={embedUrl}
          className="absolute inset-0 h-full w-full"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          title="Embedded video"
        />
        <button
          type="button"
          onDoubleClick={() => setEditing(true)}
          className="absolute inset-0 h-full w-full cursor-default"
          title="Double-click to change URL"
          aria-label="Double-click to edit embed URL"
        />
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
        ({ commands }: CommandProps) => {
          return commands.insertContent({
            attrs: { url: options.url },
            type: this.name,
          });
        },
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
