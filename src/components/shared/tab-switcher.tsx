import { type KeyboardEvent, type ReactNode, useRef } from 'react';
import { cn } from '@/lib/utils';

interface TabOption<T extends string> {
  /** Screen-reader name, for tabs whose label is icon- or count-led. */
  ariaLabel?: string;
  label: ReactNode;
  value: T;
}

interface TabSwitcherProps<T extends string> {
  /** Accessible name of the tablist. */
  ariaLabel: string;
  /** Ties each tab to the shared panel; spread `tabPanelProps(idPrefix, value)` on that region. */
  idPrefix: string;
  onChange: (value: T) => void;
  options: TabOption<T>[];
  /** Override the controlled region's id when two switchers drive one panel (inbox lane + tab). */
  panelId?: string;
  /** `md` where tabs carry an icon (matches `SegmentedControl`). */
  size?: 'md' | 'sm';
  value: T;
}

/** Props for the region a `TabSwitcher` controls, wiring `tabpanel` to the selected tab. */
export function tabPanelProps(idPrefix: string, value: string) {
  return {
    'aria-labelledby': `${idPrefix}-tab-${value}`,
    id: `${idPrefix}-panel`,
    role: 'tabpanel' as const,
  };
}

/**
 * The `SegmentedControl` look with real tab semantics, for a control that
 * switches which content is shown (Active/Archived, inbox lanes and tabs).
 * `SegmentedControl` stays the right primitive for display toggles that do not
 * swap a region: it announces `aria-pressed` buttons, which for a view switch
 * tells a screen-reader user nothing about what changed.
 *
 * `role=tablist`/`tab`, `aria-selected`, roving tabindex (only the selected tab
 * is in the Tab order) and Arrow/Home/End keys with automatic activation.
 */
export function TabSwitcher<T extends string>({
  ariaLabel,
  idPrefix,
  onChange,
  options,
  panelId,
  size = 'sm',
  value,
}: TabSwitcherProps<T>) {
  const buttons = useRef(new Map<T, HTMLButtonElement>());

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const index = options.findIndex(o => o.value === value);
    let next = -1;
    if (e.key === 'ArrowRight') {
      next = (index + 1) % options.length;
    } else if (e.key === 'ArrowLeft') {
      next = (index - 1 + options.length) % options.length;
    } else if (e.key === 'Home') {
      next = 0;
    } else if (e.key === 'End') {
      next = options.length - 1;
    }
    const target = next >= 0 && index >= 0 ? options[next] : undefined;
    if (!target) {
      return;
    }
    e.preventDefault();
    onChange(target.value);
    buttons.current.get(target.value)?.focus();
  };

  return (
    <div
      aria-label={ariaLabel}
      className="flex rounded-md border border-border p-0.5"
      onKeyDown={handleKeyDown}
      role="tablist"
    >
      {options.map(opt => {
        const selected = value === opt.value;
        return (
          <button
            aria-controls={panelId ?? `${idPrefix}-panel`}
            aria-label={opt.ariaLabel}
            aria-selected={selected}
            className={cn(
              'flex items-center gap-1 rounded px-2 text-xs transition-colors',
              size === 'md' ? 'py-1' : 'py-0.5',
              selected ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
            )}
            id={`${idPrefix}-tab-${opt.value}`}
            key={opt.value}
            onClick={() => onChange(opt.value)}
            ref={el => {
              if (el) {
                buttons.current.set(opt.value, el);
              } else {
                buttons.current.delete(opt.value);
              }
            }}
            role="tab"
            tabIndex={selected ? 0 : -1}
            type="button"
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
