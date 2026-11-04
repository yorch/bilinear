'use client';

import type { CommandProps } from '@tiptap/core';
import { mergeAttributes, Node } from '@tiptap/core';
import type { NodeViewProps } from '@tiptap/react';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { Pencil } from 'lucide-react';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useTranslations } from '@/hooks/use-translations';
import { cn, TOUCH_TARGET_SQUARE } from '@/lib/utils';

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
  const fieldId = useId();
  const url = (node.attrs.url as string) ?? '';
  const [editing, setEditing] = useState(!url);
  const embedUrl = url ? getEmbedUrl(url) : null;

  const handleSubmit = (value: string) => {
    updateAttributes({ url: value });
    setEditing(false);
  };

  if (editing || !embedUrl) {
    const inputId = `${fieldId}-url`;
    return (
      <NodeViewWrapper>
        <div className="embed-editor my-2 rounded-md border border-input bg-card p-3">
          <label className="mb-2 block text-xs font-medium text-muted-foreground" htmlFor={inputId}>
            {t('editor.embed.urlLabel')}
          </label>
          <form
            className="flex gap-2"
            onSubmit={e => {
              e.preventDefault();
              handleSubmit(new FormData(e.currentTarget).get('url') as string);
            }}
          >
            <Input
              className="flex-1 text-xs"
              defaultValue={url}
              id={inputId}
              name="url"
              placeholder="https://youtube.com/watch?v=..."
              type="url"
            />
            <Button size="xs" type="submit">
              {t('editor.embed.submit')}
            </Button>
          </form>
          {url && !embedUrl && (
            <p className="mt-1 text-xs text-danger-subtle-foreground" role="alert">
              {t('editor.embed.unsupportedUrl')}
            </p>
          )}
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper>
      <div
        className={cn(
          'embed-block group relative my-2 aspect-video w-full max-w-2xl overflow-hidden rounded-md border border-border',
          selected && 'border-brand',
        )}
      >
        <iframe
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="absolute inset-0 h-full w-full"
          sandbox="allow-scripts allow-same-origin allow-presentation allow-popups allow-popups-to-escape-sandbox"
          src={embedUrl}
          title={t('editor.embed.videoTitle')}
        />
        <button
          aria-label={t('editor.embed.editAriaLabel')}
          className={cn(
            'absolute right-2 top-2 z-10 flex items-center justify-center rounded bg-surface-raised p-1.5 text-foreground opacity-0 shadow-e1 transition-opacity hover:bg-accent focus-visible:opacity-100 group-hover:opacity-100 max-md:opacity-100',
            selected && 'opacity-100',
            TOUCH_TARGET_SQUARE,
          )}
          onClick={() => setEditing(true)}
          title={t('editor.embed.editAriaLabel')}
          type="button"
        >
          <Pencil aria-hidden="true" className="h-3 w-3" />
        </button>
      </div>
    </NodeViewWrapper>
  );
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    embed: {
      /** Insert an embed block for `url`. */
      insertEmbed: (options: { url: string }) => ReturnType;
    };
  }
}

export const EmbedNode = Node.create({
  addAttributes() {
    return {
      url: {
        default: '',
        parseHTML: el => el.getAttribute('data-url') ?? '',
        // Single source: without this TipTap also emitted a bare `url="…"`.
        renderHTML: attrs => ({ 'data-url': attrs.url as string }),
      },
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
    };
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
