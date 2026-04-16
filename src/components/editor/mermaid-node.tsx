'use client';

import type { CommandProps } from '@tiptap/core';
import { mergeAttributes, Node } from '@tiptap/core';
import type { NodeViewProps } from '@tiptap/react';
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';

// Mermaid is large — lazy-load it only when a diagram is first rendered.
async function renderMermaid(code: string, id: string): Promise<string> {
  const mermaid = (await import('mermaid')).default;
  mermaid.initialize({ startOnLoad: false, theme: 'neutral' });
  const { svg } = await mermaid.render(id, code);
  return svg;
}

function MermaidView({ node, updateAttributes, selected }: NodeViewProps) {
  const code = (node.attrs.code as string) ?? '';
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [editing, setEditing] = useState(!code);
  const idRef = useRef(`mermaid-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    if (!code) return;
    renderMermaid(code, idRef.current)
      .then(result => {
        setSvg(result);
        setError('');
      })
      .catch(err => {
        setError(String(err));
        setSvg('');
      });
  }, [code]);

  if (editing) {
    return (
      <NodeViewWrapper>
        <div className="mermaid-editor my-2 rounded-md border border-zinc-300 bg-zinc-50 p-2 dark:border-zinc-700 dark:bg-zinc-900">
          <p className="mb-1 text-xs font-medium text-zinc-500">
            Mermaid diagram
          </p>
          <textarea
            className="w-full rounded border border-zinc-200 bg-white p-2 font-mono text-xs text-zinc-800 focus:outline-none focus:ring-1 focus:ring-indigo-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200"
            rows={6}
            defaultValue={code}
            placeholder={'graph TD\n  A --> B'}
            onBlur={e => {
              updateAttributes({ code: e.target.value });
              if (e.target.value) setEditing(false);
            }}
            autoFocus
          />
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper>
      <button
        type="button"
        className={`mermaid-block relative my-2 w-full cursor-pointer rounded-md border p-3 text-left ${
          selected
            ? 'border-indigo-400 bg-indigo-50/30 dark:bg-indigo-950/20'
            : 'border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900'
        }`}
        onDoubleClick={() => setEditing(true)}
        title="Double-click to edit"
      >
        {error ? (
          <pre className="whitespace-pre-wrap text-xs text-red-500">
            {error}
          </pre>
        ) : (
          // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid-generated SVG
          <div dangerouslySetInnerHTML={{ __html: svg }} />
        )}
      </button>
      {/* Hidden content node keeps ProseMirror happy */}
      <NodeViewContent className="hidden" />
    </NodeViewWrapper>
  );
}

export const MermaidNode = Node.create({
  addAttributes() {
    return {
      code: { default: '' },
    };
  },

  addCommands() {
    return {
      setMermaid:
        () =>
        ({ commands }: CommandProps) => {
          return commands.insertContent({
            attrs: { code: '' },
            type: this.name,
          });
        },
    } as never;
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidView);
  },
  atom: true,
  content: 'text*',
  defining: true,
  group: 'block',
  marks: '',
  name: 'mermaid',

  parseHTML() {
    return [{ tag: 'div[data-type="mermaid"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-type': 'mermaid' }),
      0,
    ];
  },
});
