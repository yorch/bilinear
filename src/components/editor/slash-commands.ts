import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/react';
import Suggestion from '@tiptap/suggestion';

export interface SlashCommandItem {
  title: string;
  description: string;
  icon: string;
  command: (editor: Editor) => void;
}

const SLASH_COMMANDS: SlashCommandItem[] = [
  {
    command: editor => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    description: 'Large section heading',
    icon: 'H1',
    title: 'Heading 1',
  },
  {
    command: editor => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    description: 'Medium section heading',
    icon: 'H2',
    title: 'Heading 2',
  },
  {
    command: editor => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    description: 'Small section heading',
    icon: 'H3',
    title: 'Heading 3',
  },
  {
    command: editor => editor.chain().focus().toggleBulletList().run(),
    description: 'Unordered list',
    icon: '•',
    title: 'Bullet List',
  },
  {
    command: editor => editor.chain().focus().toggleOrderedList().run(),
    description: 'Ordered list',
    icon: '1.',
    title: 'Numbered List',
  },
  {
    command: editor => editor.chain().focus().toggleTaskList().run(),
    description: 'Todo list with checkboxes',
    icon: '☐',
    title: 'Task List',
  },
  {
    command: editor => editor.chain().focus().toggleCodeBlock().run(),
    description: 'Code block with syntax highlighting',
    icon: '</>',
    title: 'Code Block',
  },
  {
    command: editor => editor.chain().focus().toggleBlockquote().run(),
    description: 'Highlight a quote',
    icon: '❝',
    title: 'Blockquote',
  },
  {
    command: editor =>
      editor
        .chain()
        .focus()
        .insertTable({ cols: 3, rows: 3, withHeaderRow: true })
        .run(),
    description: 'Insert a table',
    icon: '⊞',
    title: 'Table',
  },
  {
    command: editor => editor.chain().focus().setHorizontalRule().run(),
    description: 'Horizontal divider line',
    icon: '—',
    title: 'Divider',
  },
];

// Client-side popup rendered via tippy; this extension wires up the trigger.
export const SlashCommands = Extension.create({
  addOptions() {
    return {
      suggestion: {
        char: '/',
        command: ({
          editor,
          range,
          props,
        }: {
          editor: Editor;
          range: { from: number; to: number };
          props: SlashCommandItem;
        }) => {
          editor.chain().focus().deleteRange(range).run();
          props.command(editor);
        },
        items: ({ query }: { query: string }) => {
          const q = query.toLowerCase();
          return SLASH_COMMANDS.filter(
            item =>
              item.title.toLowerCase().includes(q) ||
              item.description.toLowerCase().includes(q),
          );
        },
        // Render function is intentionally minimal — we rely on the BubbleMenu
        // approach; a full popup renderer requires a React portal which adds
        // significant complexity for now.
        render: () => ({
          onExit: () => {},
          onKeyDown: () => false,
          onStart: () => {},
          onUpdate: () => {},
        }),
      },
    };
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ];
  },
  name: 'slashCommands',
});
