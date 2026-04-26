import type { CommandProps } from '@tiptap/core';
import { mergeAttributes, Node } from '@tiptap/core';

export const DetailsSummary = Node.create({
  content: 'inline*',
  defining: true,
  group: '',
  name: 'detailsSummary',

  parseHTML() {
    return [{ tag: 'summary' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['summary', mergeAttributes(HTMLAttributes), 0];
  },
});

export const Details = Node.create({
  addAttributes() {
    return {
      open: { default: true },
    };
  },

  addCommands() {
    return {
      setDetails:
        () =>
        ({ commands }: CommandProps) =>
          commands.insertContent({
            content: [
              {
                content: [{ text: 'Summary', type: 'text' }],
                type: 'detailsSummary',
              },
              { type: 'paragraph' },
            ],
            type: this.name,
          }),
    } as never;
  },
  content: 'detailsSummary block+',
  defining: true,
  group: 'block',
  name: 'details',

  parseHTML() {
    return [{ tag: 'details' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['details', mergeAttributes(HTMLAttributes, { open: '' }), 0];
  },
});
