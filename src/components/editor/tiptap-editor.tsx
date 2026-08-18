'use client';

import { HocuspocusProvider } from '@hocuspocus/provider';
import { CharacterCount } from '@tiptap/extension-character-count';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { Collaboration } from '@tiptap/extension-collaboration';
import { CollaborationCaret } from '@tiptap/extension-collaboration-caret';
import { Color } from '@tiptap/extension-color';
import { Highlight } from '@tiptap/extension-highlight';
import { HorizontalRule } from '@tiptap/extension-horizontal-rule';
import { Image } from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import Mention from '@tiptap/extension-mention';
import { Placeholder } from '@tiptap/extension-placeholder';
import { Table } from '@tiptap/extension-table';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableRow } from '@tiptap/extension-table-row';
import { TaskItem } from '@tiptap/extension-task-item';
import { TaskList } from '@tiptap/extension-task-list';
import { TextStyle } from '@tiptap/extension-text-style';
import { Underline } from '@tiptap/extension-underline';
import type { Editor } from '@tiptap/react';
import { EditorContent, ReactRenderer, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
// `common` ships the ~35 most popular grammars (js/ts/py/go/rust/sql/etc)
// rather than `all` (~190 grammars, multi-MB). Covers realistic code-block
// usage in an issue tracker and trims the editor bundle significantly.
import { common, createLowlight } from 'lowlight';
import { ImageIcon, Link2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import * as Y from 'yjs';
import { PromptDialog } from '@/components/shared/prompt-dialog';
import { useTranslations } from '@/hooks/use-translations';
import { DEFAULT_YJS_PORT } from '@/lib/collab';
import { cn, TOUCH_TARGET } from '@/lib/utils';
import { resolveBrowserWsUrl } from '@/lib/ws-url';
import { useCollabConfig } from '@/providers/collab-provider';
import { Details, DetailsSummary } from './details-node';
import { EmbedNode } from './embed-node';
import type { MentionItem, MentionListHandle } from './mention-list';
import { MentionList } from './mention-list';
import { MermaidNode } from './mermaid-node';
import { SlashCommands } from './slash-commands';
import './tiptap-editor.css';

const lowlight = createLowlight(common);

// Build-time fallbacks. These used to be the ONLY way to configure collab,
// which meant a deployment running a prebuilt image could not enable it at
// all — `next build` inlines NEXT_PUBLIC_* values. The live config now comes
// from `useCollabConfig()` (server-resolved per request, see
// src/lib/collab.ts); these are consulted only when it is unset, so
// build-from-source setups keep working exactly as before.
const BUILD_TIME_COLLAB_ENABLED = process.env.NEXT_PUBLIC_COLLAB_ENABLED === 'true';
const BUILD_TIME_YJS_SERVER_URL = process.env.NEXT_PUBLIC_YJS_SERVER_URL;

// Fetch a short-lived ws_ticket from the Next.js API. The ticket is a 60s
// scoped JWT that the YJS server accepts without needing the long-lived access
// cookie — same pattern as the sync WebSocket (PATTERNS.md §18).
async function fetchWsTicket(): Promise<string> {
  const res = await fetch('/api/auth/ws-ticket', { cache: 'no-store', credentials: 'include' });
  if (!res.ok) {
    throw new Error('Failed to fetch ws-ticket for YJS');
  }
  const json = (await res.json()) as { ticket: string };
  return json.ticket;
}

// Deterministic-but-varied cursor color per session. Not persisted —
// changes on reload, which is acceptable for ephemeral presence. Values
// live in globals.css (--cursor-1..10) — safe as var() references since
// this color string is synced to peers via the Yjs awareness protocol and
// every client loads the identical stylesheet.
const CURSOR_COLORS = [
  'var(--cursor-1)',
  'var(--cursor-2)',
  'var(--cursor-3)',
  'var(--cursor-4)',
  'var(--cursor-5)',
  'var(--cursor-6)',
  'var(--cursor-7)',
  'var(--cursor-8)',
  'var(--cursor-9)',
  'var(--cursor-10)',
];
function sessionColor(): string {
  return CURSOR_COLORS[Math.floor(Math.random() * CURSOR_COLORS.length)];
}

// Matches the server allow-list in /api/upload (PDFs and SVGs are accepted by
// the endpoint but only raster/vector image formats make sense to embed via
// paste/drop, so we filter client-side too).
const PASTE_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
]);

interface UploadContext {
  issueId?: string;
  projectId?: string;
}

/**
 * `/api/uploads/[...path]` only serves files attached to an issue or project
 * inside the caller's org (`FileService.findByKeyInOrg`). Posting to
 * `/api/upload` without `issueId` or `projectId` therefore creates an orphan
 * `File` row whose URL 404s for everyone. The paste/drop path uses the
 * server upload only when the caller provides a parent; otherwise we fall
 * back to a base64 data URL (same as the toolbar button) so the image still
 * renders inline.
 */
const PASTE_INLINE_LIMIT = 2 * 1024 * 1024; // 2 MB

async function insertPastedImage(
  file: File,
  editorRef: React.RefObject<Editor | null>,
  ctx: UploadContext,
) {
  if (!PASTE_IMAGE_TYPES.has(file.type)) {
    return;
  }
  const editor = editorRef.current;
  if (!editor) {
    return;
  }

  if (ctx.issueId || ctx.projectId) {
    const fd = new FormData();
    fd.append('file', file);
    if (ctx.issueId) {
      fd.append('issueId', ctx.issueId);
    }
    if (ctx.projectId) {
      fd.append('projectId', ctx.projectId);
    }
    try {
      const res = await fetch('/api/upload', { body: fd, method: 'POST' });
      if (res.ok) {
        const json = (await res.json()) as { url?: string };
        if (json.url) {
          editorRef.current?.chain().focus().setImage({ src: json.url }).run();
          return;
        }
      }
    } catch {
      // fall through to inline fallback
    }
  }

  // No parent context (or upload failed): embed as base64 inline, matching
  // the toolbar button behavior. 2 MB cap keeps row payloads sane.
  if (file.size > PASTE_INLINE_LIMIT) {
    return;
  }
  const reader = new FileReader();
  reader.onload = e => {
    const src = e.target?.result as string;
    if (src) {
      editorRef.current?.chain().focus().setImage({ src }).run();
    }
  };
  reader.readAsDataURL(file);
}

function uploadImagesFromList(
  files: FileList | null | undefined,
  editorRef: React.RefObject<Editor | null>,
  ctx: UploadContext,
): boolean {
  if (!files || files.length === 0) {
    return false;
  }
  const images = Array.from(files).filter(f => f.type.startsWith('image/'));
  if (images.length === 0) {
    return false;
  }
  for (const file of images) {
    insertPastedImage(file, editorRef, ctx);
  }
  return true;
}

export interface TipTapEditorProps {
  autofocus?: boolean;
  className?: string;
  /**
   * When set (format: "issue:<uuid>" or "document:<uuid>") and
   * NEXT_PUBLIC_COLLAB_ENABLED=true, activates real-time multi-cursor
   * collaborative editing via Hocuspocus + YJS (PATTERNS.md §51).
   * The caller must also provide `collabUserName` for the presence cursor.
   */
  collabDocId?: string;
  /** Display name shown in the collaborative cursor label. */
  collabUserName?: string;
  content?: string;
  /** Issues available for #mentions (identifier + title search). */
  mentionIssues?: MentionItem[];
  /** Projects available for ~mentions (name search). */
  mentionProjects?: MentionItem[];
  /** Users available for @mentions */
  mentionUsers?: MentionItem[];
  onBlur?: () => void;
  onChange?: (html: string) => void;
  placeholder?: string;
  readOnly?: boolean;
  showToolbar?: boolean;
  /**
   * Parent issue id for pasted/dropped image uploads. Required for the
   * `/api/upload` path to attach the new File to a parent the caller can
   * see; without it pastes fall back to base64 inline.
   */
  uploadIssueId?: string;
  /** Parent project id for pasted/dropped image uploads. See `uploadIssueId`. */
  uploadProjectId?: string;
}

// Popup dimensions match the MentionList CSS (w-48 / max-h-48)
const POPUP_W = 192;
const POPUP_H = 192;
const POPUP_GAP = 4;

/**
 * Position a fixed popup below the caret, clamping to the viewport so it
 * never overflows the right edge or the bottom of the screen.
 */
function positionPopup(
  popup: HTMLDivElement,
  clientRect: (() => DOMRect | null) | null | undefined,
) {
  const rect = clientRect?.();
  if (!rect) {
    return;
  }
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  // Prefer below caret; flip above when not enough room below.
  let top = rect.bottom + POPUP_GAP;
  if (top + POPUP_H > vh) {
    top = rect.top - POPUP_H - POPUP_GAP;
  }
  // Clamp left so the popup never goes off the right edge.
  const left = Math.min(rect.left, vw - POPUP_W - POPUP_GAP);

  popup.style.top = `${Math.max(0, top)}px`;
  popup.style.left = `${Math.max(0, left)}px`;
}

/**
 * Build the Mention extension with a React-rendered floating dropdown.
 *
 * Accepts a **ref** instead of a plain array so the `items` callback always
 * reads the latest users — TipTap extensions are created once and cannot be
 * hot-reloaded when props change.
 */
function buildMentionExtension(usersRef: React.RefObject<MentionItem[]>) {
  return Mention.configure({
    HTMLAttributes: { class: 'mention' },
    renderLabel: ({ node }) => `@${node.attrs.label ?? node.attrs.id}`,
    suggestion: {
      char: '@',
      items: ({ query }: { query: string }) => {
        const q = query.toLowerCase();
        return (usersRef.current ?? []).filter(u => u.label.toLowerCase().includes(q)).slice(0, 8);
      },
      render: () => {
        let component: ReactRenderer<MentionListHandle> | null = null;
        let popup: HTMLDivElement | null = null;

        return {
          onExit() {
            component?.destroy();
            popup?.remove();
            popup = null;
            component = null;
          },
          onKeyDown({ event }: { event: KeyboardEvent }) {
            if (event.key === 'Escape') {
              popup?.remove();
              popup = null;
              component?.destroy();
              component = null;
              return true;
            }
            return component?.ref?.onKeyDown(event) ?? false;
          },
          onStart(props: {
            editor: unknown;
            items: MentionItem[];
            command: (item: MentionItem) => void;
            clientRect?: (() => DOMRect | null) | null;
          }) {
            popup = document.createElement('div');
            popup.style.cssText = 'position:fixed;z-index:9999;pointer-events:auto;';
            document.body.appendChild(popup);

            component = new ReactRenderer(MentionList, {
              editor: props.editor as never,
              props: { command: props.command, items: props.items },
            });
            popup.appendChild(component.element);
            positionPopup(popup, props.clientRect);
          },
          onUpdate(props: {
            items: MentionItem[];
            command: (item: MentionItem) => void;
            clientRect?: (() => DOMRect | null) | null;
          }) {
            component?.updateProps({
              command: props.command,
              items: props.items,
            });
            if (popup) {
              positionPopup(popup, props.clientRect);
            }
          },
        };
      },
    },
  });
}

/**
 * Issue mention extension — triggered by `#`. Items are `{ id, label: identifier, sub: title }`.
 * Uses its own Mention instance with a `name` override so it coexists with the user mention.
 */
function buildIssueMentionExtension(issuesRef: React.RefObject<MentionItem[]>) {
  return Mention.extend({ name: 'issueMention' }).configure({
    HTMLAttributes: { class: 'issue-mention' },
    renderLabel: ({ node }) => `#${node.attrs.label ?? node.attrs.id}`,
    suggestion: {
      char: '#',
      items: ({ query }: { query: string }) => {
        const q = query.toLowerCase();
        return (issuesRef.current ?? [])
          .filter(i => i.label.toLowerCase().includes(q) || (i.sub ?? '').toLowerCase().includes(q))
          .slice(0, 8);
      },
      render: () => {
        let component: ReactRenderer<MentionListHandle> | null = null;
        let popup: HTMLDivElement | null = null;

        return {
          onExit() {
            component?.destroy();
            popup?.remove();
            popup = null;
            component = null;
          },
          onKeyDown({ event }: { event: KeyboardEvent }) {
            if (event.key === 'Escape') {
              popup?.remove();
              popup = null;
              component?.destroy();
              component = null;
              return true;
            }
            return component?.ref?.onKeyDown(event) ?? false;
          },
          onStart(props: {
            editor: unknown;
            items: MentionItem[];
            command: (item: MentionItem) => void;
            clientRect?: (() => DOMRect | null) | null;
          }) {
            popup = document.createElement('div');
            popup.style.cssText = 'position:fixed;z-index:9999;pointer-events:auto;';
            document.body.appendChild(popup);
            component = new ReactRenderer(MentionList, {
              editor: props.editor as never,
              props: { command: props.command, items: props.items },
            });
            popup.appendChild(component.element);
            positionPopup(popup, props.clientRect);
          },
          onUpdate(props: {
            items: MentionItem[];
            command: (item: MentionItem) => void;
            clientRect?: (() => DOMRect | null) | null;
          }) {
            component?.updateProps({ command: props.command, items: props.items });
            if (popup) {
              positionPopup(popup, props.clientRect);
            }
          },
        };
      },
    },
  });
}

function buildProjectMentionExtension(projectsRef: React.RefObject<MentionItem[]>) {
  return Mention.extend({ name: 'projectMention' }).configure({
    HTMLAttributes: { class: 'project-mention' },
    renderLabel: ({ node }) => `~${node.attrs.label ?? node.attrs.id}`,
    suggestion: {
      char: '~',
      items: ({ query }: { query: string }) => {
        const q = query.toLowerCase();
        return (projectsRef.current ?? [])
          .filter(p => p.label.toLowerCase().includes(q) || (p.sub ?? '').toLowerCase().includes(q))
          .slice(0, 8);
      },
      render: () => {
        let component: ReactRenderer<MentionListHandle> | null = null;
        let popup: HTMLDivElement | null = null;

        return {
          onExit() {
            component?.destroy();
            popup?.remove();
            popup = null;
            component = null;
          },
          onKeyDown({ event }: { event: KeyboardEvent }) {
            if (event.key === 'Escape') {
              popup?.remove();
              popup = null;
              component?.destroy();
              component = null;
              return true;
            }
            return component?.ref?.onKeyDown(event) ?? false;
          },
          onStart(props: {
            editor: unknown;
            items: MentionItem[];
            command: (item: MentionItem) => void;
            clientRect?: (() => DOMRect | null) | null;
          }) {
            popup = document.createElement('div');
            popup.style.cssText = 'position:fixed;z-index:9999;pointer-events:auto;';
            document.body.appendChild(popup);
            component = new ReactRenderer(MentionList, {
              editor: props.editor as never,
              props: { command: props.command, items: props.items },
            });
            popup.appendChild(component.element);
            positionPopup(popup, props.clientRect);
          },
          onUpdate(props: {
            items: MentionItem[];
            command: (item: MentionItem) => void;
            clientRect?: (() => DOMRect | null) | null;
          }) {
            component?.updateProps({ command: props.command, items: props.items });
            if (popup) {
              positionPopup(popup, props.clientRect);
            }
          },
        };
      },
    },
  });
}

export function TipTapEditor({
  content = '',
  placeholder: placeholderProp,
  onChange,
  onBlur,
  className,
  readOnly = false,
  autofocus = false,
  showToolbar = false,
  mentionIssues,
  mentionProjects,
  mentionUsers,
  uploadIssueId,
  uploadProjectId,
  collabDocId,
  collabUserName,
}: TipTapEditorProps) {
  const t = useTranslations();
  const placeholder = placeholderProp ?? t('editor.placeholder');
  const resolvedCollabUserName = collabUserName ?? t('issueDetail.defaultUserName');
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Capture the latest upload context in a ref so the paste/drop handlers
  // (created once at editor mount) always see fresh ids.
  const uploadCtxRef = useRef<UploadContext>({
    issueId: uploadIssueId,
    projectId: uploadProjectId,
  });
  uploadCtxRef.current = { issueId: uploadIssueId, projectId: uploadProjectId };

  const imageInputRef = useRef<HTMLInputElement>(null);
  // Editor ref so the paste/drop handlers (captured at editor creation) can
  // reach the live editor instance from inside an async upload callback.
  const editorRef = useRef<Editor | null>(null);

  // Keep refs to the latest mention arrays so suggestion callbacks always see
  // fresh data even though TipTap extensions cannot be hot-reloaded.
  const mentionUsersRef = useRef<MentionItem[]>(mentionUsers ?? []);
  useEffect(() => {
    mentionUsersRef.current = mentionUsers ?? [];
  }, [mentionUsers]);

  const mentionIssuesRef = useRef<MentionItem[]>(mentionIssues ?? []);
  useEffect(() => {
    mentionIssuesRef.current = mentionIssues ?? [];
  }, [mentionIssues]);

  const mentionProjectsRef = useRef<MentionItem[]>(mentionProjects ?? []);
  useEffect(() => {
    mentionProjectsRef.current = mentionProjects ?? [];
  }, [mentionProjects]);

  // ─── Collaborative editing setup ───────────────────────────────────────────
  // YJS doc and Hocuspocus provider are created once per mount (guarded by the
  // null-check). They must exist before the extensions memo so the extensions
  // can reference them. Cleanup runs in the effect at the bottom.
  //
  // The collabEnabled check includes readOnly because read-only views don't
  // need a live YJS session (they show the saved description, not the YJS doc).
  const collabConfig = useCollabConfig();
  const collabEnabled =
    (collabConfig.enabled || BUILD_TIME_COLLAB_ENABLED) && !!collabDocId && !readOnly;

  const ydocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<HocuspocusProvider | null>(null);
  // Seed flag: true once we've inserted initial content into an empty YJS doc.
  const seededRef = useRef(false);
  // Set to true when onSynced fires before the editor ref is assigned; the
  // editorRef effect will complete the seed on next render.
  const needsSeedRef = useRef(false);
  // Cursor color is chosen once per session and reused for awareness updates.
  const cursorColorRef = useRef('');
  // Capture the initial content once so the onSynced seed callback never reads
  // a stale prop value.
  const initialContentRef = useRef(content);

  if (collabEnabled && ydocRef.current === null) {
    const ydoc = new Y.Doc();
    ydocRef.current = ydoc;
    const cursorColor = sessionColor();
    cursorColorRef.current = cursorColor;

    providerRef.current = new HocuspocusProvider({
      document: ydoc,
      name: collabDocId,
      onAuthenticated: () => {
        // noop — auth success is logged server-side
      },
      onAuthenticationFailed: ({ reason }) => {
        console.warn('[collab] Authentication failed:', reason);
      },
      onSynced: ({ state }) => {
        if (!state || seededRef.current) {
          return;
        }
        // If the YJS document is empty (first collaborative session on this
        // issue) and we have existing content, seed from the saved description.
        // The YJS fragment named 'default' is what TipTap's Collaboration
        // extension binds to.
        const frag = ydoc.getXmlFragment('default');
        if (frag.length > 0 || !initialContentRef.current) {
          // Doc already has content or nothing to seed — done.
          seededRef.current = true;
          return;
        }
        if (editorRef.current) {
          editorRef.current.commands.setContent(initialContentRef.current);
          seededRef.current = true;
        } else {
          // Editor not yet mounted; flag so the editorRef effect seeds it.
          needsSeedRef.current = true;
        }
      },
      // Async token provider: fetches a fresh 60s ws_ticket on every
      // (re)connection, same rotation pattern as the sync WebSocket.
      token: fetchWsTicket,
      // Resolved through the same helper as the sync socket, so a path like
      // `/collab` becomes a same-origin `wss://` URL behind a TLS proxy. The
      // document name is NOT part of this URL — Hocuspocus sends it in-band
      // (verified against @hocuspocus/provider) — so a proxy routing this
      // path must NOT strip the prefix for the name to survive.
      url: resolveBrowserWsUrl(
        collabConfig.serverUrl ?? BUILD_TIME_YJS_SERVER_URL,
        DEFAULT_YJS_PORT,
      ),
    });

    // Stamp cursor awareness with user identity for CollaborationCaret.
    providerRef.current.setAwarenessField('user', {
      color: cursorColor,
      name: resolvedCollabUserName,
    });
  }

  // Keep the cursor label current when collabUserName changes after mount
  // (e.g. displayName loaded asynchronously after the provider was created).
  useEffect(() => {
    if (collabEnabled && providerRef.current && cursorColorRef.current) {
      providerRef.current.setAwarenessField('user', {
        color: cursorColorRef.current,
        name: resolvedCollabUserName,
      });
    }
  }, [collabEnabled, resolvedCollabUserName]);

  // Destroy provider and YJS doc on unmount.
  useEffect(
    () => () => {
      providerRef.current?.destroy();
      providerRef.current = null;
      ydocRef.current?.destroy();
      ydocRef.current = null;
      seededRef.current = false;
      needsSeedRef.current = false;
    },
    // Mount-once: every value read inside is held in a ref precisely so this
    // callback stays stable — a re-created provider would drop the live session.
    [],
  );

  // Extensions are built once — TipTap does not support hot-reloading them.
  // Mutable state (mentionUsers) is accessed via mentionUsersRef at call time.
  // biome-ignore lint/correctness/useExhaustiveDependencies: extensions must be stable after editor creation
  const extensions = useMemo(
    () => [
      StarterKit.configure({
        codeBlock: false,
        horizontalRule: false,
        // Disable StarterKit's UndoRedo when Collaboration is active — Yjs
        // provides its own undo/redo stack via the yUndoPlugin.
        undoRedo: collabEnabled ? false : undefined,
      }),
      Placeholder.configure({ placeholder }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Link.configure({
        HTMLAttributes: { rel: 'noopener noreferrer' },
        openOnClick: false,
      }),
      Image.configure({ inline: true }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      CodeBlockLowlight.configure({ lowlight }),
      TextStyle,
      Color,
      Highlight.configure({ multicolor: true }),
      Underline,
      HorizontalRule,
      CharacterCount,
      SlashCommands,
      MermaidNode,
      Details,
      DetailsSummary,
      EmbedNode,
      // Only add the Mention extension when the caller opts in by providing users.
      // The extension reads from mentionUsersRef so suggestions stay current.
      ...(mentionUsers != null ? [buildMentionExtension(mentionUsersRef)] : []),
      // Issue mentions triggered by '#'. Coexists with the user mention via name override.
      ...(mentionIssues != null ? [buildIssueMentionExtension(mentionIssuesRef)] : []),
      // Project mentions triggered by '~'.
      ...(mentionProjects != null ? [buildProjectMentionExtension(mentionProjectsRef)] : []),
      // Collaborative editing extensions — only added when a collabDocId is
      // provided and NEXT_PUBLIC_COLLAB_ENABLED=true. Collaboration replaces
      // the Yjs-incompatible StarterKit history (disabled above).
      ...(collabEnabled && ydocRef.current && providerRef.current
        ? [
            Collaboration.configure({ document: ydocRef.current }),
            CollaborationCaret.configure({
              provider: providerRef.current,
            }),
          ]
        : []),
    ],
    [],
  );

  const editor = useEditor({
    autofocus,
    // When collaborative editing is active the Yjs document is the source of
    // truth — pass no initial content so the Collaboration extension controls
    // the document state. Seeding from the saved description happens in the
    // onSynced callback above.
    content: collabEnabled ? undefined : content,
    editable: !readOnly,
    editorProps: {
      attributes: {
        class: cn(
          'prose prose-sm dark:prose-invert max-w-none focus:outline-none',
          'prose-zinc min-h-[80px]',
          readOnly ? 'cursor-default' : 'cursor-text',
        ),
      },
      handleDrop: (_view, event) => {
        const files = (event as DragEvent).dataTransfer?.files;
        return uploadImagesFromList(files, editorRef, uploadCtxRef.current);
      },
      handlePaste: (_view, event) => {
        const items = (event as ClipboardEvent).clipboardData?.items;
        if (!items) {
          return false;
        }
        const files: File[] = [];
        for (const item of Array.from(items)) {
          if (item.kind === 'file' && item.type.startsWith('image/')) {
            const file = item.getAsFile();
            if (file) {
              files.push(file);
            }
          }
        }
        if (files.length === 0) {
          return false;
        }
        event.preventDefault();
        for (const file of files) {
          insertPastedImage(file, editorRef, uploadCtxRef.current);
        }
        return true;
      },
    },
    extensions,
    immediatelyRender: false,
    onBlur: () => onBlur?.(),
    onUpdate: ({ editor: ed }) => {
      onChangeRef.current?.(ed.getHTML());
    },
  });

  useEffect(() => {
    editorRef.current = editor;
    // Complete deferred seeding if onSynced fired before the editor mounted.
    if (editor && needsSeedRef.current && !seededRef.current) {
      const frag = ydocRef.current?.getXmlFragment('default');
      if (frag && frag.length === 0 && initialContentRef.current) {
        editor.commands.setContent(initialContentRef.current);
      }
      seededRef.current = true;
      needsSeedRef.current = false;
    }
  }, [editor]);

  // Sync external content changes into the editor — but only when collab is
  // disabled. With collaborative editing the Yjs document owns the content;
  // applying the stale prop would overwrite in-flight collaborative updates.
  useEffect(() => {
    if (!editor || collabEnabled) {
      return;
    }
    const current = editor.getHTML();
    if (current !== content && !editor.isFocused) {
      editor.commands.setContent(content ?? '');
    }
  }, [editor, content, collabEnabled]);

  /**
   * The selection the link applies to, captured when the dialog opens.
   *
   * This is the whole reason the link prompt outlived the other `window.prompt`
   * replacements. A native prompt blocks synchronously and never touches the
   * ProseMirror selection, so `extendMarkRange('link')` was guaranteed to act on
   * what the user had highlighted. A dialog takes focus into the browser's top
   * layer, and a selection restored only by `.focus()` is a selection you are
   * *hoping* survived — get it wrong and the link silently lands on the wrong
   * text. Capturing `from`/`to` up front and replaying them with
   * `setTextSelection` makes that independent of whatever focus did.
   */
  const [linkTarget, setLinkTarget] = useState<{ from: number; href: string; to: number } | null>(
    null,
  );

  const openLinkDialog = useCallback(() => {
    if (!editor) {
      return;
    }
    const { from, to } = editor.state.selection;
    setLinkTarget({ from, href: editor.getAttributes('link').href ?? '', to });
  }, [editor]);

  const applyLink = useCallback(
    (url: string) => {
      const target = linkTarget;
      setLinkTarget(null);
      if (!editor || !target) {
        return;
      }
      const chain = editor
        .chain()
        .focus()
        .setTextSelection({ from: target.from, to: target.to })
        .extendMarkRange('link');
      // An empty field clears the link, matching what the prompt's empty string
      // did; cancelling closes without touching the document, as returning null
      // did.
      const trimmed = url.trim();
      (trimmed === '' ? chain.unsetLink() : chain.setLink({ href: trimmed })).run();
    },
    [editor, linkTarget],
  );

  /**
   * Insert an image from a file input — converts to a base64 data URL.
   *
   * ⚠️ Base64 images are stored inline in the issue description HTML, so large
   * images will bloat DB records and sync payloads. Until server-side file
   * storage is wired up (the `File` model exists in the schema), images are
   * capped at 2 MB. Larger files are silently skipped.
   */
  const handleImageFile = useCallback(
    (file: File) => {
      const MAX_SIZE = 2 * 1024 * 1024; // 2 MB
      if (!editor || !file.type.startsWith('image/') || file.size > MAX_SIZE) {
        return;
      }
      const reader = new FileReader();
      reader.onload = e => {
        const src = e.target?.result as string;
        if (src) {
          editor.chain().focus().setImage({ src }).run();
        }
      };
      reader.readAsDataURL(file);
    },
    [editor],
  );

  if (!editor) {
    return null;
  }

  return (
    <div className={cn('tiptap-wrapper relative', className)}>
      {showToolbar && !readOnly && (
        <div className="mb-2 flex flex-wrap items-center gap-0.5 rounded-md border border-border bg-muted p-1 dark:bg-muted/50">
          <ToolbarButton
            active={editor.isActive('bold')}
            onClick={() => editor.chain().focus().toggleBold().run()}
            title={t('editor.toolbar.bold')}
          >
            <strong>B</strong>
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive('italic')}
            onClick={() => editor.chain().focus().toggleItalic().run()}
            title={t('editor.toolbar.italic')}
          >
            <em>I</em>
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive('underline')}
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            title={t('editor.toolbar.underline')}
          >
            <span className="underline">U</span>
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive('strike')}
            onClick={() => editor.chain().focus().toggleStrike().run()}
            title={t('editor.toolbar.strikethrough')}
          >
            <span className="line-through">S</span>
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive('link')}
            onClick={openLinkDialog}
            title={t('editor.toolbar.link')}
          >
            <Link2 className="h-3 w-3" />
          </ToolbarButton>
          <div className="mx-1 h-4 w-px bg-border" />
          <ToolbarButton
            active={editor.isActive('heading', { level: 1 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
            title={t('editor.toolbar.heading1')}
          >
            H1
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive('heading', { level: 2 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
            title={t('editor.toolbar.heading2')}
          >
            H2
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive('heading', { level: 3 })}
            onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
            title={t('editor.toolbar.heading3')}
          >
            H3
          </ToolbarButton>
          <div className="mx-1 h-4 w-px bg-border" />
          <ToolbarButton
            active={editor.isActive('bulletList')}
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            title={t('editor.toolbar.bulletList')}
          >
            •—
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive('orderedList')}
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            title={t('editor.toolbar.orderedList')}
          >
            1.
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive('taskList')}
            onClick={() => editor.chain().focus().toggleTaskList().run()}
            title={t('editor.toolbar.taskList')}
          >
            ☐
          </ToolbarButton>
          <div className="mx-1 h-4 w-px bg-border" />
          <ToolbarButton
            active={editor.isActive('codeBlock')}
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            title={t('editor.toolbar.codeBlock')}
          >
            {'{}'}
          </ToolbarButton>
          <ToolbarButton
            active={editor.isActive('blockquote')}
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            title={t('editor.toolbar.blockquote')}
          >
            ❝
          </ToolbarButton>
          <ToolbarButton
            active={false}
            onClick={() =>
              editor.chain().focus().insertTable({ cols: 3, rows: 3, withHeaderRow: true }).run()
            }
            title={t('editor.toolbar.insertTable')}
          >
            ⊞
          </ToolbarButton>
          <ToolbarButton
            active={false}
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            title={t('editor.toolbar.divider')}
          >
            —
          </ToolbarButton>
          <div className="mx-1 h-4 w-px bg-border" />
          {/* Image upload */}
          <ToolbarButton
            active={false}
            onClick={() => imageInputRef.current?.click()}
            title={t('editor.toolbar.insertImage')}
          >
            <ImageIcon className="h-3 w-3" />
          </ToolbarButton>
          <input
            accept="image/*"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0];
              if (file) {
                handleImageFile(file);
              }
              // Reset so same file can be selected again
              e.target.value = '';
            }}
            ref={imageInputRef}
            type="file"
          />
        </div>
      )}

      <EditorContent editor={editor} />

      <PromptDialog
        initialValue={linkTarget?.href ?? ''}
        label={t('editor.linkPrompt')}
        onCancel={() => setLinkTarget(null)}
        onSubmit={applyLink}
        open={linkTarget !== null}
        title={t('editor.toolbar.link')}
      />
    </div>
  );
}

function ToolbarButton({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void;
  active: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-label={title}
      className={cn(
        'rounded px-1.5 py-0.5 text-xs font-medium transition-colors',
        TOUCH_TARGET,
        active
          ? 'bg-brand-subtle text-brand-subtle-foreground'
          : 'text-muted-foreground hover:bg-foreground/10',
      )}
      onClick={onClick}
      onMouseDown={e => e.preventDefault()}
      title={title}
      type="button"
    >
      {children}
    </button>
  );
}
