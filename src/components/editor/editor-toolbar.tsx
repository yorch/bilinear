'use client';

import type { Editor } from '@tiptap/react';
import { useEditorState } from '@tiptap/react';
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  ImageIcon,
  Italic,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  Minus,
  Quote,
  Strikethrough,
  Table,
  Underline,
} from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useModKey } from '@/hooks/use-mod-key';
import { useTranslations } from '@/hooks/use-translations';
import { cn, TOUCH_TARGET } from '@/lib/utils';

interface EditorToolbarProps {
  editor: Editor;
  onImage: () => void;
  onLink: () => void;
}

const ICON = 'h-4 w-4';

/**
 * Fixed formatting toolbar. A single tab stop (roving tabindex) with
 * Left/Right/Home/End moving between buttons, `aria-pressed` on toggles, and a
 * second contextual row of table controls while the caret is inside a table.
 */
export function EditorToolbar({ editor, onImage, onLink }: EditorToolbarProps) {
  const t = useTranslations();
  const barRef = useRef<HTMLDivElement>(null);
  const [rovingIndex, setRovingIndex] = useState(0);

  // Re-render on selection/doc changes so `aria-pressed` tracks the caret.
  const state = useEditorState({
    editor,
    selector: ({ editor: e }) => ({
      blockquote: e.isActive('blockquote'),
      bold: e.isActive('bold'),
      bulletList: e.isActive('bulletList'),
      codeBlock: e.isActive('codeBlock'),
      h1: e.isActive('heading', { level: 1 }),
      h2: e.isActive('heading', { level: 2 }),
      h3: e.isActive('heading', { level: 3 }),
      inTable: e.isActive('table'),
      italic: e.isActive('italic'),
      link: e.isActive('link'),
      orderedList: e.isActive('orderedList'),
      strike: e.isActive('strike'),
      taskList: e.isActive('taskList'),
      underline: e.isActive('underline'),
    }),
  });

  const modKey = useModKey();
  const run = (fn: () => void) => fn();
  const chain = () => editor.chain().focus();

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const buttons = Array.from(
      barRef.current?.querySelectorAll<HTMLButtonElement>('[data-toolbar-item]') ?? [],
    );
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (current === -1) {
      return;
    }
    let next = current;
    if (e.key === 'ArrowRight') {
      next = (current + 1) % buttons.length;
    } else if (e.key === 'ArrowLeft') {
      next = (current - 1 + buttons.length) % buttons.length;
    } else if (e.key === 'Home') {
      next = 0;
    } else if (e.key === 'End') {
      next = buttons.length - 1;
    } else {
      return;
    }
    e.preventDefault();
    setRovingIndex(next);
    buttons[next]?.focus();
  };

  // Index is assigned in render order so the roving tabindex stays correct as
  // the table row appears/disappears.
  let index = 0;
  const item = (
    key: string,
    label: string,
    pressed: boolean | undefined,
    onClick: () => void,
    children: ReactNode,
    shortcut?: string,
  ) => {
    const i = index++;
    const title = shortcut ? `${label} (${shortcut})` : label;
    return (
      <button
        aria-label={label}
        aria-pressed={pressed}
        className={cn(
          'flex items-center justify-center rounded px-1.5 py-0.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          TOUCH_TARGET,
          pressed
            ? 'bg-brand-subtle text-brand-subtle-foreground'
            : 'text-muted-foreground hover:bg-foreground/10',
        )}
        data-toolbar-item
        key={key}
        onClick={() => run(onClick)}
        onFocus={() => setRovingIndex(i)}
        onMouseDown={e => e.preventDefault()}
        tabIndex={i === rovingIndex ? 0 : -1}
        title={title}
        type="button"
      >
        {children}
      </button>
    );
  };
  const divider = (key: string) => (
    <div aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-border" key={key} />
  );

  const mod = modKey === '⌘' ? '⌘' : 'Ctrl+';

  const tableActions: Array<[string, string, () => void]> = [
    ['addRow', t('editor.table.addRow'), () => chain().addRowAfter().run()],
    ['addCol', t('editor.table.addColumn'), () => chain().addColumnAfter().run()],
    ['delRow', t('editor.table.deleteRow'), () => chain().deleteRow().run()],
    ['delCol', t('editor.table.deleteColumn'), () => chain().deleteColumn().run()],
    ['header', t('editor.table.toggleHeader'), () => chain().toggleHeaderRow().run()],
    ['delTable', t('editor.table.deleteTable'), () => chain().deleteTable().run()],
  ];

  return (
    <div className="sticky top-0 z-10 mb-2 flex flex-col gap-1 rounded-md border border-border bg-background">
      <div
        aria-label={t('editor.toolbar.label')}
        aria-orientation="horizontal"
        className="flex flex-nowrap items-center gap-0.5 overflow-x-auto bg-muted p-1 md:flex-wrap md:overflow-visible dark:bg-muted/50"
        onKeyDown={onKeyDown}
        ref={barRef}
        role="toolbar"
      >
        {item(
          'bold',
          t('editor.toolbar.bold'),
          state.bold,
          () => chain().toggleBold().run(),
          <Bold className={ICON} />,
          `${mod}B`,
        )}
        {item(
          'italic',
          t('editor.toolbar.italic'),
          state.italic,
          () => chain().toggleItalic().run(),
          <Italic className={ICON} />,
          `${mod}I`,
        )}
        {item(
          'underline',
          t('editor.toolbar.underline'),
          state.underline,
          () => chain().toggleUnderline().run(),
          <Underline className={ICON} />,
          `${mod}U`,
        )}
        {item(
          'strike',
          t('editor.toolbar.strikethrough'),
          state.strike,
          () => chain().toggleStrike().run(),
          <Strikethrough className={ICON} />,
        )}
        {item('link', t('editor.toolbar.link'), state.link, onLink, <Link2 className={ICON} />)}
        {divider('d1')}
        {item(
          'h1',
          t('editor.toolbar.heading1'),
          state.h1,
          () => chain().toggleHeading({ level: 1 }).run(),
          <Heading1 className={ICON} />,
        )}
        {item(
          'h2',
          t('editor.toolbar.heading2'),
          state.h2,
          () => chain().toggleHeading({ level: 2 }).run(),
          <Heading2 className={ICON} />,
        )}
        {item(
          'h3',
          t('editor.toolbar.heading3'),
          state.h3,
          () => chain().toggleHeading({ level: 3 }).run(),
          <Heading3 className={ICON} />,
        )}
        {divider('d2')}
        {item(
          'bullets',
          t('editor.toolbar.bulletList'),
          state.bulletList,
          () => chain().toggleBulletList().run(),
          <List className={ICON} />,
        )}
        {item(
          'ordered',
          t('editor.toolbar.orderedList'),
          state.orderedList,
          () => chain().toggleOrderedList().run(),
          <ListOrdered className={ICON} />,
        )}
        {item(
          'tasks',
          t('editor.toolbar.taskList'),
          state.taskList,
          () => chain().toggleTaskList().run(),
          <ListChecks className={ICON} />,
        )}
        {divider('d3')}
        {item(
          'code',
          t('editor.toolbar.codeBlock'),
          state.codeBlock,
          () => chain().toggleCodeBlock().run(),
          <Code className={ICON} />,
        )}
        {item(
          'quote',
          t('editor.toolbar.blockquote'),
          state.blockquote,
          () => chain().toggleBlockquote().run(),
          <Quote className={ICON} />,
        )}
        {item(
          'table',
          t('editor.toolbar.insertTable'),
          // An action, not a toggle: no aria-pressed (the table sub-toolbar
          // already announces being inside a table).
          undefined,
          () => chain().insertTable({ cols: 3, rows: 3, withHeaderRow: true }).run(),
          <Table className={ICON} />,
        )}
        {item(
          'hr',
          t('editor.toolbar.divider'),
          undefined,
          () => chain().setHorizontalRule().run(),
          <Minus className={ICON} />,
        )}
        {divider('d4')}
        {item(
          'image',
          t('editor.toolbar.insertImage'),
          undefined,
          onImage,
          <ImageIcon className={ICON} />,
        )}
      </div>
      {state.inTable && (
        <div
          aria-label={t('editor.table.label')}
          className="flex flex-nowrap items-center gap-1 overflow-x-auto border-t border-border p-1 md:flex-wrap"
          onKeyDown={e => {
            // Arrow / Home / End move between the table actions, like the main bar.
            const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
            if (!keys.includes(e.key)) {
              return;
            }
            const btns = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('button'));
            const cur = btns.indexOf(document.activeElement as HTMLButtonElement);
            if (cur === -1) {
              return;
            }
            e.preventDefault();
            const last = btns.length - 1;
            const next =
              e.key === 'Home'
                ? 0
                : e.key === 'End'
                  ? last
                  : e.key === 'ArrowRight'
                    ? (cur + 1) % btns.length
                    : (cur - 1 + btns.length) % btns.length;
            btns[next]?.focus();
          }}
          role="toolbar"
        >
          {tableActions.map(([key, label, action]) => (
            <Button
              className={cn('shrink-0', TOUCH_TARGET)}
              key={key}
              onClick={action}
              onMouseDown={e => e.preventDefault()}
              size="xs"
              type="button"
              variant="ghost"
            >
              {label}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
