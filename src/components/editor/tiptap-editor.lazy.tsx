'use client';

import dynamic from 'next/dynamic';
import type { TipTapEditorProps } from './tiptap-editor';

// Lazy wrapper around TipTapEditor. The underlying module pulls in
// StarterKit + 14 extensions + lowlight (common grammars) + mermaid node +
// embed node — easily 200-400KB gzip. Loading it only on demand keeps the
// workspace bundle lean for users who never open an issue detail / modal
// / comment editor. ssr:false because the editor is client-only (uses
// DOM APIs + React refs).
export const TipTapEditor = dynamic<TipTapEditorProps>(
  () => import('./tiptap-editor').then(m => ({ default: m.TipTapEditor })),
  { ssr: false },
);
