'use client';

import { useEffect } from 'react';

interface ShortcutEntry {
  description: string;
  keys: string[];
}

interface ShortcutSection {
  shortcuts: ShortcutEntry[];
  title: string;
}

const SECTIONS: ShortcutSection[] = [
  {
    shortcuts: [
      { description: 'Command palette', keys: ['Ctrl/⌘', 'K'] },
      { description: 'Toggle sidebar', keys: ['Ctrl/⌘', 'B'] },
      { description: 'Create issue', keys: ['C'] },
      { description: 'Open shortcuts', keys: ['?'] },
    ],
    title: 'Global',
  },
  {
    shortcuts: [
      { description: 'Go to My Issues', keys: ['G', 'I'] },
      { description: 'Go to Inbox', keys: ['G', 'N'] },
    ],
    title: 'Navigation',
  },
  {
    shortcuts: [
      { description: 'Move down', keys: ['J'] },
      { description: 'Move up', keys: ['K'] },
      { description: 'Open issue', keys: ['Enter'] },
      { description: 'Close / deselect', keys: ['Esc'] },
    ],
    title: 'Issue List',
  },
  {
    shortcuts: [
      { description: 'Set status', keys: ['S'] },
      { description: 'Set assignee', keys: ['A'] },
      { description: 'Set priority', keys: ['P'] },
      { description: 'Set label', keys: ['L'] },
      { description: 'Set due date', keys: ['D'] },
      { description: 'Set estimate', keys: ['Shift', 'E'] },
      { description: 'Set project', keys: ['Shift', 'P'] },
      { description: 'Set cycle', keys: ['Q'] },
      { description: 'Archive issue', keys: ['Backspace'] },
    ],
    title: 'Issue Actions',
  },
  {
    shortcuts: [
      { description: 'List view', keys: ['Alt', '1'] },
      { description: 'Board view', keys: ['Alt', '2'] },
      { description: 'Timeline view', keys: ['Alt', '3'] },
    ],
    title: 'View',
  },
];

interface ShortcutHelpModalProps {
  onClose: () => void;
  open: boolean;
}

function KbdGroup({ keys }: { keys: string[] }) {
  return (
    <span className="flex items-center gap-0.5">
      {keys.map((k, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: static shortcut key arrays never reorder
        <span className="flex items-center gap-0.5" key={`${k}-${i}`}>
          {i > 0 && <span className="text-xs text-zinc-400">+</span>}
          <kbd className="rounded border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 text-xs font-mono dark:border-zinc-600 dark:bg-zinc-800">
            {k}
          </kbd>
        </span>
      ))}
    </span>
  );
}

export function ShortcutHelpModal({ onClose, open }: ShortcutHelpModalProps) {
  // Close on Escape
  useEffect(() => {
    if (!open) {
      return;
    }

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  const handleBackdropKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    // Backdrop
    <div
      aria-label="Keyboard shortcuts"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={handleBackdropClick}
      onKeyDown={handleBackdropKeyDown}
      role="dialog"
    >
      {/* Card */}
      <div className="w-full max-w-xl overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-zinc-100 px-6 py-4 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            Keyboard Shortcuts
          </h2>
          <button
            aria-label="Close shortcuts"
            className="rounded p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800 dark:hover:text-zinc-300"
            onClick={onClose}
            type="button"
          >
            <svg
              aria-hidden="true"
              className="h-4 w-4"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                d="M6 18L18 6M6 6l12 12"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
              />
            </svg>
          </button>
        </div>

        {/* Body — two-column grid of sections */}
        <div className="max-h-[70vh] overflow-y-auto p-6">
          <div className="grid grid-cols-2 gap-x-8 gap-y-6">
            {SECTIONS.map(section => (
              <div key={section.title}>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">
                  {section.title}
                </p>
                <div className="space-y-1.5">
                  {section.shortcuts.map(shortcut => (
                    <div
                      className="flex items-center justify-between gap-4"
                      key={shortcut.description}
                    >
                      <span className="text-sm text-zinc-700 dark:text-zinc-300">
                        {shortcut.description}
                      </span>
                      <KbdGroup keys={shortcut.keys} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end border-t border-zinc-100 px-6 py-3 dark:border-zinc-800">
          <span className="text-xs text-zinc-400">
            Press{' '}
            <kbd className="rounded border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 text-xs font-mono dark:border-zinc-600 dark:bg-zinc-800">
              Esc
            </kbd>{' '}
            to close
          </span>
        </div>
      </div>
    </div>
  );
}
