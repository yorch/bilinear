'use client';

import { cn } from '@/lib/utils';

interface TipTapEditorProps {
  content?: string;
  placeholder?: string;
  onChange?: (content: string) => void;
  onBlur?: () => void;
  className?: string;
  readOnly?: boolean;
  minHeight?: number;
}

// TODO: Install TipTap for full rich text editing:
// yarn add @tiptap/react @tiptap/starter-kit @tiptap/extension-placeholder
// @tiptap/extension-mention @tiptap/extension-task-list @tiptap/extension-task-item
// @tiptap/extension-link @tiptap/extension-image
//
// This is a minimal stub implementation until TipTap is installed.
export function TipTapEditor({
  content = '',
  placeholder = 'Add a description...',
  onChange,
  onBlur,
  className,
  readOnly = false,
  minHeight = 120,
}: TipTapEditorProps) {
  return (
    <textarea
      value={content}
      readOnly={readOnly}
      placeholder={placeholder}
      onChange={e => onChange?.(e.target.value)}
      onBlur={onBlur}
      className={cn(
        'w-full resize-none rounded-md p-2 text-sm text-zinc-700 dark:text-zinc-300',
        'bg-transparent focus:outline-none',
        !readOnly && 'hover:bg-zinc-50 dark:hover:bg-zinc-800',
        'placeholder:text-zinc-400 placeholder:italic',
        className,
      )}
      style={{ minHeight }}
    />
  );
}
