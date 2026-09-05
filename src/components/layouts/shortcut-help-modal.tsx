'use client';

import { ModalDialog, ModalHeader } from '@/components/ui/modal-dialog';
import { useTranslations } from '@/hooks/use-translations';

interface ShortcutEntry {
  descriptionKey: string;
  keys: string[];
}

interface ShortcutSection {
  shortcuts: ShortcutEntry[];
  titleKey: string;
}

/**
 * Every entry here must have a live handler (`useHotkeys` in
 * `use-issue-list-page.ts` / `workspace-client.tsx`). The modal is not a
 * roadmap — an advertised key that does nothing reads as a broken app.
 */
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
          {i > 0 && <span className="text-xs text-muted-foreground">+</span>}
          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-mono">
            {k}
          </kbd>
        </span>
      ))}
    </span>
  );
}

export function ShortcutHelpModal({ onClose, open }: ShortcutHelpModalProps) {
  const t = useTranslations();

  // `ModalDialog` owns the focus trap, backdrop click and the Escape → `cancel`
  // contract; the previous hand-rolled dialog listened on `window` and let
  // focus wander behind the overlay.
  return (
    <ModalDialog
      aria-label={t('layout.shortcutHelp.title')}
      maxWidth="xl"
      onClose={onClose}
      open={open}
    >
      <ModalHeader title={t('layout.shortcutHelp.title')} />

      {/* Body — two-column grid of sections */}
      <div className="max-h-[70vh] overflow-y-auto p-6">
        <div className="grid grid-cols-2 gap-x-8 gap-y-6">
          {SECTIONS.map(section => (
            <div key={section.titleKey}>
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t(section.titleKey)}
              </p>
              <div className="space-y-1.5">
                {section.shortcuts.map(shortcut => (
                  <div
                    className="flex items-center justify-between gap-4"
                    key={shortcut.descriptionKey}
                  >
                    <span className="text-sm text-foreground-secondary">
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
      <div className="flex items-center justify-end border-t border-border px-6 py-3">
        <span className="text-xs text-muted-foreground">
          {t('layout.shortcutHelp.pressPrefix')}{' '}
          <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 text-xs font-mono">
            Esc
          </kbd>{' '}
          {t('layout.shortcutHelp.pressSuffix')}
        </span>
      </div>
    </ModalDialog>
  );
}
