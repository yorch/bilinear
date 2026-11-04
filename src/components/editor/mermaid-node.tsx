'use client';

import type { CommandProps } from '@tiptap/core';
import { mergeAttributes, Node } from '@tiptap/core';
import type { NodeViewProps } from '@tiptap/react';
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useTheme } from '@/hooks/use-theme';
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
    //
    // `layout` and `look` are pinned for the same reason, one rung down in
    // severity: Mermaid 12 switched the default layout engine from dagre to
    // ELK and the default look from 'classic' to 'neo'. Both are global
    // defaults, so inheriting them would silently restyle every diagram users
    // have already authored and saved — a dependency bump is the wrong place
    // for that. Adopting ELK/neo is a deliberate visual change; make it on its
    // own, where the before/after is the point of the diff.
    m.default.initialize({
      layout: 'dagre',
      look: 'classic',
      securityLevel: 'strict',
      startOnLoad: false,
      theme: 'neutral',
    });
    return m.default;
  });
}

/**
 * DOM spec for a mermaid node. A leaf (atom) node must not contain a content
 * hole (`0`) — ProseMirror throws `RangeError: Content hole not allowed in a
 * leaf node spec` the first time the document is serialised, which is on every
 * edit via `getHTML()`.
 */
export function mermaidRenderSpec(
  code: string,
  htmlAttributes: Record<string, unknown> = {},
): ['div', Record<string, unknown>] {
  return ['div', mergeAttributes(htmlAttributes, { 'data-code': code, 'data-type': 'mermaid' })];
}

function firstLine(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return (
    text
      .split('\n')
      .find(l => l.trim())
      ?.trim() ?? text
  );
}

async function renderMermaid(code: string, id: string, theme: 'dark' | 'neutral'): Promise<string> {
  if (!mermaidReady) {
    mermaidReady = loadMermaid();
  }
  const mermaid = await mermaidReady;
  // Cheap and idempotent; picks up the current app theme for this render.
  mermaid.initialize({
    layout: 'dagre',
    look: 'classic',
    securityLevel: 'strict',
    startOnLoad: false,
    theme,
  });
  const { svg } = await mermaid.render(id, code);
  return svg;
}

function MermaidView({ node, updateAttributes, selected }: NodeViewProps) {
  const t = useTranslations();
  const { resolvedTheme } = useTheme();
  const code = (node.attrs.code as string) ?? '';
  const [svg, setSvg] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [editing, setEditing] = useState(!code);
  const [draft, setDraft] = useState(code);
  // Lazy initialiser: `useRef(expr)` evaluated `expr` on every render and threw
  // all but the first away. Not `useId()` — React ids contain ':', which
  // mermaid.render() would emit into an SVG element id and a generated CSS
  // selector, where it does not parse.
  const [diagramId] = useState(() => `mermaid-${Math.random().toString(36).slice(2)}`);
  const mermaidTheme = resolvedTheme === 'dark' ? 'dark' : 'neutral';

  // Re-renders on a theme flip as well as on a source change, so a diagram
  // never stays a light SVG on a dark card.
  useEffect(() => {
    if (!code) {
      return;
    }
    let cancelled = false;
    renderMermaid(code, diagramId, mermaidTheme)
      .then(result => {
        if (!cancelled) {
          setSvg(result);
          setError('');
        }
      })
      .catch(err => {
        if (!cancelled) {
          setError(firstLine(err));
          setSvg('');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [code, diagramId, mermaidTheme]);

  const startEditing = () => {
    setDraft(code);
    setEditing(true);
  };

  // The editor closes only once the committed source is visible on the node.
  // It used to close right after `updateAttributes`, so when the attribute
  // update did not land (the node view re-created mid-transaction while a new
  // document was still syncing) the block collapsed to an empty diagram and the
  // empty source was saved. Now the draft stays on screen until the node
  // reports it, and one retry covers a dropped first dispatch.
  const pendingCommit = useRef<string | null>(null);

  useEffect(() => {
    if (pendingCommit.current !== null && code === pendingCommit.current) {
      pendingCommit.current = null;
      setEditing(false);
    }
  }, [code]);

  const commit = () => {
    const source = draft;
    if (!source.trim()) {
      return;
    }
    if (source === code) {
      setEditing(false);
      return;
    }
    pendingCommit.current = source;
    updateAttributes({ code: source });
    setTimeout(() => {
      if (pendingCommit.current === source) {
        updateAttributes({ code: source });
      }
    }, 250);
  };

  const cancel = () => {
    setDraft(code);
    if (code) {
      setEditing(false);
    }
  };

  if (editing) {
    const labelId = `${diagramId}-label`;
    return (
      <NodeViewWrapper>
        <div className="mermaid-editor my-2 rounded-md border border-input bg-card p-2">
          <label className="mb-1 block text-xs font-medium text-muted-foreground" id={labelId}>
            {t('editor.mermaid.label')}
            <textarea
              className="mt-1 w-full rounded border border-input bg-card p-2 font-mono text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-brand"
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  e.stopPropagation();
                  cancel();
                } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  commit();
                }
              }}
              placeholder={'graph TD\n  A --> B'}
              rows={6}
              value={draft}
            />
          </label>
          <div className="flex justify-end gap-2">
            {code && (
              <Button onClick={cancel} size="xs" type="button" variant="ghost">
                {t('common.cancel')}
              </Button>
            )}
            <Button disabled={!draft.trim()} onClick={commit} size="xs" type="button">
              {t('editor.mermaid.done')}
            </Button>
          </div>
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper>
      <div
        className={cn(
          'mermaid-block group relative my-2 w-full rounded-md border border-border bg-card p-3',
          selected && 'border-brand bg-brand-subtle',
        )}
      >
        {error ? (
          <p className="text-xs text-danger-subtle-foreground" role="alert">
            {t('editor.mermaid.renderError', { message: error })}
          </p>
        ) : (
          // biome-ignore lint/security/noDangerouslySetInnerHtml: mermaid-generated SVG
          <div dangerouslySetInnerHTML={{ __html: svg }} />
        )}
        <Button
          className={cn(
            'absolute right-2 top-2 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 max-md:opacity-100',
            selected && 'opacity-100',
          )}
          onClick={startEditing}
          size="xs"
          title={t('editor.mermaid.editHint')}
          type="button"
          variant="outline"
        >
          {t('common.edit')}
        </Button>
      </div>
    </NodeViewWrapper>
  );
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    mermaid: {
      /** Insert an empty Mermaid diagram block. */
      setMermaid: () => ReturnType;
    };
  }
}

export const MermaidNode = Node.create({
  addAttributes() {
    return {
      code: {
        default: '',
        // The source lives in `data-code` only. Without these TipTap's default
        // also emitted a bare `code="…"` (every diagram stored twice) and on
        // parse preferred that copy over `data-code`.
        parseHTML: el => el.getAttribute('data-code') ?? '',
        renderHTML: attrs => ({ 'data-code': attrs.code as string }),
      },
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
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidView);
  },
  atom: true,
  defining: true,
  group: 'block',
  marks: '',
  name: 'mermaid',

  // The diagram source lives in `data-code`: an atom has no content to carry it,
  // so without this the source was dropped on every save/reload.
  parseHTML() {
    return [{ tag: 'div[data-type="mermaid"]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return mermaidRenderSpec(node.attrs.code as string, HTMLAttributes);
  },
});
