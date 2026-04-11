'use client';

import { CharacterCount } from '@tiptap/extension-character-count';
import { CodeBlockLowlight } from '@tiptap/extension-code-block-lowlight';
import { Color } from '@tiptap/extension-color';
import { Highlight } from '@tiptap/extension-highlight';
import { HorizontalRule } from '@tiptap/extension-horizontal-rule';
import { Image } from '@tiptap/extension-image';
import Link from '@tiptap/extension-link';
import { Placeholder } from '@tiptap/extension-placeholder';
import { Table } from '@tiptap/extension-table';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableRow } from '@tiptap/extension-table-row';
import { TaskItem } from '@tiptap/extension-task-item';
import { TaskList } from '@tiptap/extension-task-list';
import { TextStyle } from '@tiptap/extension-text-style';
import { Underline } from '@tiptap/extension-underline';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { all, createLowlight } from 'lowlight';
import { Link2 } from 'lucide-react';
import { useCallback, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
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
}: TipTapEditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

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
    extensions: [
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
    ],
    onBlur: () => onBlur?.(),
    onUpdate: ({ editor }) => {
      onChangeRef.current?.(editor.getHTML());
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
