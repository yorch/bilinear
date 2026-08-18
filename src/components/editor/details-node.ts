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
      // `as never` is forced by upstream, not laziness. The documented way to type a
      // custom command is `declare module '@tiptap/core' { interface Commands<…> }`,
      // but @tiptap/core ships a rollup-bundled `index.d.ts` that declares the
      // interface as `Commands$1` and re-exports it as `type Commands$1 as Commands`
      // (dist/index.d.ts:5125). An external augmentation therefore declares a *new*
      // `Commands` in that module rather than merging into `Commands$1`, which is
      // what `RawCommands` is actually built from — so the command never lands in
      // `RawCommands` and `addCommands()` still fails to type-check. TipTap's own
      // commands work only because they are declared inside that same file.
      // Verified against @tiptap/core 3.28.0; retry the augmentation when the
      // package ships unbundled types.
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
