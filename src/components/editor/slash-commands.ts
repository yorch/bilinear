import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/react';
import { ReactRenderer } from '@tiptap/react';
import Suggestion from '@tiptap/suggestion';
import type { SlashCommandListHandle } from './slash-command-list';

export interface SlashCommandItem {
  title: string;
  description: string;
  icon: string;
  command: (editor: Editor) => void;
}

export const SLASH_COMMANDS: SlashCommandItem[] = [
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
  {
    // Resolved at call-time so the extension import stays cycle-free
    command: editor =>
      (
        editor.chain().focus() as ReturnType<typeof editor.chain> & {
          setDetails?: () => { run: () => void };
        }
      )
        .setDetails?.()
        .run(),
    description: 'Collapsible section',
    icon: '▶',
    title: 'Toggle',
  },
  {
    command: editor =>
      (
        editor.chain().focus() as ReturnType<typeof editor.chain> & {
          insertEmbed?: (opts: { url: string }) => { run: () => void };
        }
      )
        .insertEmbed?.({ url: '' })
        .run(),
    description: 'Embed a YouTube or Loom video',
    icon: '▷',
    title: 'Embed',
  },
  {
    command: editor =>
      (
        editor.chain().focus() as ReturnType<typeof editor.chain> & {
          setMermaid?: () => { run: () => void };
        }
      )
        .setMermaid?.()
        .run(),
    description: 'Mermaid diagram block',
    icon: '⬡',
    title: 'Diagram',
  },
];

// Popup dimensions match SlashCommandList CSS (w-64 / max-h-72)
const POPUP_W = 256;
const POPUP_H = 288;
const POPUP_GAP = 4;

function positionPopup(
  popup: HTMLDivElement,
  clientRect: (() => DOMRect | null) | null | undefined,
) {
  const rect = clientRect?.();
  if (!rect) return;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let top = rect.bottom + POPUP_GAP;
  if (top + POPUP_H > vh) top = rect.top - POPUP_H - POPUP_GAP;
  const left = Math.min(rect.left, vw - POPUP_W - POPUP_GAP);

  popup.style.top = `${Math.max(0, top)}px`;
  popup.style.left = `${Math.max(0, left)}px`;
}

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
        render: () => {
          let component: ReactRenderer<SlashCommandListHandle> | null = null;
          let popup: HTMLDivElement | null = null;

          // Lazy-import to avoid a circular dep at module evaluation time.
          // The component module is already bundled — this just defers the
          // require() call until the first keystroke.
          const getListComponent = async () => {
            const mod = await import('./slash-command-list');
            return mod.SlashCommandList;
          };

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
            async onStart(props: {
              editor: unknown;
              items: SlashCommandItem[];
              command: (item: SlashCommandItem) => void;
              clientRect?: (() => DOMRect | null) | null;
            }) {
              const SlashCommandList = await getListComponent();
              popup = document.createElement('div');
              popup.style.cssText =
                'position:fixed;z-index:9999;pointer-events:auto;';
              document.body.appendChild(popup);

              component = new ReactRenderer(SlashCommandList, {
                editor: props.editor as never,
                props: { command: props.command, items: props.items },
              });
              popup.appendChild(component.element);
              positionPopup(popup, props.clientRect);
            },
            onUpdate(props: {
              items: SlashCommandItem[];
              command: (item: SlashCommandItem) => void;
              clientRect?: (() => DOMRect | null) | null;
            }) {
              component?.updateProps({
                command: props.command,
                items: props.items,
              });
              if (popup) positionPopup(popup, props.clientRect);
            },
          };
        },
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
