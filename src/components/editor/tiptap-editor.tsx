'use client';

import { CharacterCount } from '@tiptap/extension-character-count';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
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
import { EditorContent, ReactRenderer, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { all, createLowlight } from 'lowlight';
import { ImageIcon, Link2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { cn } from '@/lib/utils';
import type { MentionItem, MentionListHandle } from './mention-list';
import { MentionList } from './mention-list';
import './tiptap-editor.css';

const lowlight = createLowlight(all);

export interface TipTapEditorProps {
  content?: string;
  placeholder?: string;
  onChange?: (html: string) => void;
  onBlur?: () => void;
  className?: string;
  readOnly?: boolean;
  autofocus?: boolean;
  showToolbar?: boolean;
  /** Users available for @mentions */
  mentionUsers?: MentionItem[];
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
        return (usersRef.current ?? [])
          .filter(u => u.label.toLowerCase().includes(q))
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
            popup.style.cssText =
              'position:fixed;z-index:9999;pointer-events:auto;';
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

export function TipTapEditor({
  content = '',
  placeholder = 'Add a description…',
  onChange,
  onBlur,
  className,
  readOnly = false,
  autofocus = false,
  showToolbar = false,
  mentionUsers,
}: TipTapEditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const imageInputRef = useRef<HTMLInputElement>(null);

  // Keep a ref to the latest mentionUsers so the suggestion `items` callback
  // always reads fresh data even though TipTap extensions cannot be hot-reloaded.
  const mentionUsersRef = useRef<MentionItem[]>(mentionUsers ?? []);
  useEffect(() => {
    mentionUsersRef.current = mentionUsers ?? [];
  }, [mentionUsers]);

  // Extensions are built once — TipTap does not support hot-reloading them.
  // Mutable state (mentionUsers) is accessed via mentionUsersRef at call time.
  // biome-ignore lint/correctness/useExhaustiveDependencies: extensions must be stable after editor creation
  const extensions = useMemo(
    () => [
      StarterKit.configure({
        codeBlock: false,
        horizontalRule: false,
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
      // Only add the Mention extension when the caller opts in by providing users.
      // The extension reads from mentionUsersRef so suggestions stay current.
      ...(mentionUsers != null ? [buildMentionExtension(mentionUsersRef)] : []),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const editor = useEditor({
    autofocus,
    content,
    editable: !readOnly,
    editorProps: {
      attributes: {
        class: cn(
          'prose prose-sm dark:prose-invert max-w-none focus:outline-none',
          'prose-zinc min-h-[80px]',
          readOnly ? 'cursor-default' : 'cursor-text',
        ),
      },
    },
    extensions,
    onBlur: () => onBlur?.(),
    onUpdate: ({ editor: ed }) => {
      onChangeRef.current?.(ed.getHTML());
    },
  });

  useEffect(() => {
    if (!editor) {
      return;
    }
    const current = editor.getHTML();
    if (current !== content && !editor.isFocused) {
      editor.commands.setContent(content ?? '');
    }
  }, [editor, content]);

  const setLink = useCallback(() => {
    if (!editor) {
      return;
    }
    const prev = editor.getAttributes('link').href ?? '';
    const url = window.prompt('URL', prev);
    if (url === null) {
      return;
    }
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
    } else {
      editor
        .chain()
        .focus()
        .extendMarkRange('link')
        .setLink({ href: url })
        .run();
    }
  }, [editor]);

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
        <div className="mb-2 flex flex-wrap items-center gap-0.5 rounded-md border border-zinc-200 bg-zinc-50 p-1 dark:border-zinc-700 dark:bg-zinc-800/50">
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBold().run()}
            active={editor.isActive('bold')}
            title="Bold"
          >
            <strong>B</strong>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleItalic().run()}
            active={editor.isActive('italic')}
            title="Italic"
          >
            <em>I</em>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleUnderline().run()}
            active={editor.isActive('underline')}
            title="Underline"
          >
            <span className="underline">U</span>
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleStrike().run()}
            active={editor.isActive('strike')}
            title="Strikethrough"
          >
            <span className="line-through">S</span>
          </ToolbarButton>
          <ToolbarButton
            onClick={setLink}
            active={editor.isActive('link')}
            title="Link"
          >
            <Link2 className="h-3 w-3" />
          </ToolbarButton>
          <div className="mx-1 h-4 w-px bg-zinc-300 dark:bg-zinc-600" />
          <ToolbarButton
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 1 }).run()
            }
            active={editor.isActive('heading', { level: 1 })}
            title="Heading 1"
          >
            H1
          </ToolbarButton>
          <ToolbarButton
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 2 }).run()
            }
            active={editor.isActive('heading', { level: 2 })}
            title="Heading 2"
          >
            H2
          </ToolbarButton>
          <ToolbarButton
            onClick={() =>
              editor.chain().focus().toggleHeading({ level: 3 }).run()
            }
            active={editor.isActive('heading', { level: 3 })}
            title="Heading 3"
          >
            H3
          </ToolbarButton>
          <div className="mx-1 h-4 w-px bg-zinc-300 dark:bg-zinc-600" />
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBulletList().run()}
            active={editor.isActive('bulletList')}
            title="Bullet list"
          >
            •—
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleOrderedList().run()}
            active={editor.isActive('orderedList')}
            title="Ordered list"
          >
            1.
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleTaskList().run()}
            active={editor.isActive('taskList')}
            title="Task list"
          >
            ☐
          </ToolbarButton>
          <div className="mx-1 h-4 w-px bg-zinc-300 dark:bg-zinc-600" />
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleCodeBlock().run()}
            active={editor.isActive('codeBlock')}
            title="Code block"
          >
            {'{}'}
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().toggleBlockquote().run()}
            active={editor.isActive('blockquote')}
            title="Blockquote"
          >
            ❝
          </ToolbarButton>
          <ToolbarButton
            onClick={() =>
              editor
                .chain()
                .focus()
                .insertTable({ cols: 3, rows: 3, withHeaderRow: true })
                .run()
            }
            active={false}
            title="Insert table"
          >
            ⊞
          </ToolbarButton>
          <ToolbarButton
            onClick={() => editor.chain().focus().setHorizontalRule().run()}
            active={false}
            title="Divider"
          >
            —
          </ToolbarButton>
          <div className="mx-1 h-4 w-px bg-zinc-300 dark:bg-zinc-600" />
          {/* Image upload */}
          <ToolbarButton
            onClick={() => imageInputRef.current?.click()}
            active={false}
            title="Insert image"
          >
            <ImageIcon className="h-3 w-3" />
          </ToolbarButton>
          <input
            ref={imageInputRef}
            type="file"
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
          />
        </div>
      )}

      <EditorContent editor={editor} />
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
      type="button"
      onClick={onClick}
      title={title}
      className={cn(
        'rounded px-1.5 py-0.5 text-xs font-medium transition-colors',
        active
          ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
          : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-700',
      )}
    >
      {children}
    </button>
  );
}
