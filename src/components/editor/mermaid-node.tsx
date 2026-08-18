'use client';

import type { CommandProps } from '@tiptap/core';
import { mergeAttributes, Node } from '@tiptap/core';
import type { NodeViewProps } from '@tiptap/react';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { useEffect, useState } from 'react';
import { useTranslations } from '@/hooks/use-translations';
import { cn } from '@/lib/utils';

// Mermaid is large — lazy-load it only when a diagram is first rendered.
// Cache the promise so initialize() only runs once even under concurrent renders.
let mermaidReady: ReturnType<typeof loadMermaid> | null = null;

function loadMermaid() {
  return import('mermaid').then(m => {
    // `securityLevel` is pinned rather than inherited: diagram source is
    // document content any org member can author, and the rendered SVG goes
    // straight into `dangerouslySetInnerHTML` below. 'strict' is Mermaid's
    // current default, so this changes nothing today — it stops a future
    // upstream default from silently turning that sink into stored XSS.
    m.default.initialize({ securityLevel: 'strict', startOnLoad: false, theme: 'neutral' });
    return m.default;
  });
}

async function renderMermaid(code: string, id: string): Promise<string> {
  if (!mermaidReady) {
    mermaidReady = loadMermaid();
  }
  const mermaid = await mermaidReady;
  const { svg } = await mermaid.render(id, code);
  return svg;
}

function MermaidView({ node, updateAttributes, selected }: NodeViewProps) {
  const t = useTranslations();
  const code = (node.attrs.code as string) ?? '';
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [editing, setEditing] = useState(!code);
  // Lazy initialiser: `useRef(expr)` evaluated `expr` on every render and threw
  // all but the first away. Not `useId()` — React ids contain ':', which
  // mermaid.render() would emit into an SVG element id and a generated CSS
  // selector, where it does not parse.
  const [diagramId] = useState(() => `mermaid-${Math.random().toString(36).slice(2)}`);

  useEffect(() => {
    if (!code) {
      return;
    }
    renderMermaid(code, diagramId)
      .then(result => {
        setSvg(result);
        setError('');
      })
      .catch(err => {
        setError(String(err));
        setSvg('');
      });
  }, [code, diagramId]);

  if (editing) {
    return (
      <NodeViewWrapper>
        <div className="mermaid-editor my-2 rounded-md border border-border bg-card p-2">
          <p className="mb-1 text-xs font-medium text-muted-foreground">
            {t('editor.mermaid.label')}
          </p>
          <textarea
            className="w-full rounded border border-border bg-card p-2 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-brand"
            defaultValue={code}
            onBlur={e => {
              updateAttributes({ code: e.target.value });
              if (e.target.value) {
                setEditing(false);
              }
            }}
            placeholder={'graph TD\n  A --> B'}
            rows={6}
          />
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper>
      <button
        className={cn(
          'mermaid-block relative my-2 w-full cursor-pointer rounded-md border p-3 text-left',
          selected
            ? 'border-brand bg-brand-subtle/30 dark:bg-brand-subtle'
            : 'border-border bg-card',
        )}
        onDoubleClick={() => setEditing(true)}
        title={t('editor.mermaid.editHint')}
        type="button"
      >
        {error ? (
          <pre className="whitespace-pre-wrap text-xs text-danger-subtle-foreground">{error}</pre>
        ) : (
          // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid-generated SVG
          <div dangerouslySetInnerHTML={{ __html: svg }} />
        )}
      </button>
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
        ({ commands }: CommandProps) =>
          commands.insertContent({
            attrs: { code: '' },
            type: this.name,
          }),
    } as never;
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidView);
  },
  atom: true,
  defining: true,
  group: 'block',
  marks: '',
  name: 'mermaid',

  parseHTML() {
    return [{ tag: 'div[data-type="mermaid"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-type': 'mermaid' }), 0];
  },
});
