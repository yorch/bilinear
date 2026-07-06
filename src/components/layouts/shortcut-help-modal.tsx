'use client';

import { useEffect } from 'react';
import { useTranslations } from '@/hooks/use-translations';

interface ShortcutEntry {
  descriptionKey: string;
  keys: string[];
}

interface ShortcutSection {
  shortcuts: ShortcutEntry[];
  titleKey: string;
}

const SECTIONS: ShortcutSection[] = [
  {
    shortcuts: [
      { descriptionKey: 'layout.shortcutHelp.commandPalette', keys: ['Ctrl/⌘', 'K'] },
      { descriptionKey: 'layout.shortcutHelp.toggleSidebar', keys: ['Ctrl/⌘', 'B'] },
      { descriptionKey: 'layout.shortcutHelp.createIssue', keys: ['C'] },
      { descriptionKey: 'layout.shortcutHelp.openShortcuts', keys: ['?'] },
    ],
    titleKey: 'layout.shortcutHelp.sections.global',
  },
  {
    shortcuts: [
      { descriptionKey: 'layout.shortcutHelp.goToMyIssues', keys: ['G', 'I'] },
      { descriptionKey: 'layout.shortcutHelp.goToInbox', keys: ['G', 'N'] },
    ],
    titleKey: 'layout.shortcutHelp.sections.navigation',
  },
  {
    shortcuts: [
      { descriptionKey: 'layout.shortcutHelp.moveDown', keys: ['J'] },
      { descriptionKey: 'layout.shortcutHelp.moveUp', keys: ['K'] },
      { descriptionKey: 'layout.shortcutHelp.openIssue', keys: ['Enter'] },
      { descriptionKey: 'layout.shortcutHelp.closeDeselect', keys: ['Esc'] },
    ],
    titleKey: 'layout.shortcutHelp.sections.issueList',
  },
  {
    shortcuts: [
      { descriptionKey: 'layout.shortcutHelp.setStatus', keys: ['S'] },
      { descriptionKey: 'layout.shortcutHelp.setAssignee', keys: ['A'] },
      { descriptionKey: 'layout.shortcutHelp.setPriority', keys: ['P'] },
      { descriptionKey: 'layout.shortcutHelp.setLabel', keys: ['L'] },
      { descriptionKey: 'layout.shortcutHelp.setDueDate', keys: ['D'] },
      { descriptionKey: 'layout.shortcutHelp.setEstimate', keys: ['Shift', 'E'] },
      { descriptionKey: 'layout.shortcutHelp.setProject', keys: ['Shift', 'P'] },
      { descriptionKey: 'layout.shortcutHelp.setCycle', keys: ['Q'] },
      { descriptionKey: 'layout.shortcutHelp.archiveIssue', keys: ['Backspace'] },
    ],
    titleKey: 'layout.shortcutHelp.sections.issueActions',
  },
  {
    shortcuts: [
      { descriptionKey: 'layout.shortcutHelp.listView', keys: ['Alt', '1'] },
      { descriptionKey: 'layout.shortcutHelp.boardView', keys: ['Alt', '2'] },
      { descriptionKey: 'layout.shortcutHelp.timelineView', keys: ['Alt', '3'] },
    ],
    titleKey: 'layout.shortcutHelp.sections.view',
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
  const t = useTranslations();

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
      aria-label={t('layout.shortcutHelp.title')}
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
          <h2 className="text-sm font-semibold text-foreground">
            {t('layout.shortcutHelp.title')}
          </h2>
          <button
            aria-label={t('layout.shortcutHelp.closeAriaLabel')}
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
              <div key={section.titleKey}>
                <p className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-400">
                  {t(section.titleKey)}
                </p>
                <div className="space-y-1.5">
                  {section.shortcuts.map(shortcut => (
                    <div
                      className="flex items-center justify-between gap-4"
                      key={shortcut.descriptionKey}
                    >
                      <span className="text-sm text-zinc-700 dark:text-zinc-300">
                        {t(shortcut.descriptionKey)}
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
            {t('layout.shortcutHelp.pressPrefix')}{' '}
            <kbd className="rounded border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 text-xs font-mono dark:border-zinc-600 dark:bg-zinc-800">
              Esc
            </kbd>{' '}
            {t('layout.shortcutHelp.pressSuffix')}
          </span>
        </div>
      </div>
    </div>
  );
}
