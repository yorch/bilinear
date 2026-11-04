'use client';

import { Inbox } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AccentToggle } from '@/components/accent-toggle';
import { LanguageToggle } from '@/components/language-toggle';
import { ConfirmDialog } from '@/components/shared/confirm-dialog';
import { InlineRetry } from '@/components/shared/inline-retry';
import { SectionCard } from '@/components/shared/section-card';
import { ThemeToggle } from '@/components/theme-toggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ColorDot } from '@/components/ui/color-dot';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { ProgressBar } from '@/components/ui/progress-bar';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { SimpleSelect } from '@/components/ui/select';
import { POPOVER_ITEM_CLASS, SelectPopover } from '@/components/ui/select-popover';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { UserAvatar } from '@/components/ui/user-avatar';
import { ACCENT_DEFINITIONS, accentSwatchGradient } from '@/lib/accent';
import { toast } from '@/lib/toast';
import { cn, TOUCH_ROW } from '@/lib/utils';

/**
 * Design-system reference route (`/design`).
 *
 * Deliberately not translated and not behind the workspace shell: this is an
 * internal reference for verifying the token layer and every shared primitive in
 * a real browser. It reads the live document tokens, so switching accent,
 * theme or language with the controls at the top re-renders every specimen
 * below.
 */

const SECTIONS = [
  { id: 'accents', label: 'Accents' },
  { id: 'surfaces', label: 'Surfaces' },
  { id: 'ink', label: 'Ink' },
  { id: 'brand', label: 'Brand' },
  { id: 'status', label: 'Status' },
  { id: 'typography', label: 'Type' },
  { id: 'scale', label: 'Scale' },
  { id: 'elevation', label: 'Elevation' },
  { id: 'controls', label: 'Controls' },
  { id: 'forms', label: 'Forms' },
  { id: 'overlays', label: 'Overlays' },
  { id: 'layout', label: 'Layout' },
  { id: 'indicators', label: 'Indicators' },
  { id: 'loading', label: 'Loading' },
];

const RADII = ['sm', 'md', 'lg', 'xl'];
const SPACING = [1, 2, 3, 4, 6, 8, 12];

const SELECT_OPTIONS = [
  { label: 'Backlog', value: 'backlog' },
  { label: 'In progress', value: 'progress' },
  { label: 'Done', value: 'done' },
];

/**
 * Bumps whenever the theme class or accent attribute on `<html>` changes, so
 * specimens that read computed tokens re-read them after a toggle.
 */
function useTokenVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const observer = new MutationObserver(() => setVersion(v => v + 1));
    observer.observe(document.documentElement, {
      attributeFilter: ['class', 'data-accent'],
      attributes: true,
    });
    setVersion(v => v + 1);
    return () => observer.disconnect();
  }, []);
  return version;
}

const SURFACE_TOKENS = [
  'background',
  'card',
  'popover',
  'muted',
  'accent',
  'secondary',
  'surface-raised',
  'surface-sunken',
];

const INK_TOKENS = ['foreground', 'foreground-secondary', 'muted-foreground', 'foreground-faint'];

const BRAND_TOKENS = ['brand', 'brand-2', 'brand-hover', 'brand-subtle', 'brand-border', 'ring'];

const SEMANTIC_TOKENS = [
  'destructive',
  'chart-actual',
  'chart-warning',
  'chart-grid',
  'state-default',
];

const STATUS_ROLES = ['danger', 'warning', 'success', 'info', 'merged'];

const PRIORITIES = [
  { label: 'Urgent', token: '--priority-urgent' },
  { label: 'High', token: '--priority-high' },
  { label: 'Medium', token: '--priority-medium' },
  { label: 'Low', token: '--priority-low' },
  { label: 'None', token: '--priority-none' },
];

function Section({
  children,
  id,
  note,
  title,
}: {
  children: React.ReactNode;
  id: string;
  note?: string;
  title: string;
}) {
  return (
    <section className="flex scroll-mt-28 flex-col gap-4 border-t border-border py-10" id={id}>
      <div className="flex flex-col gap-1.5">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
        {note && <p className="max-w-2xl text-sm text-muted-foreground">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function Swatch({ name }: { name: string }) {
  const version = useTokenVersion();
  // `version` is the dependency: the computed value changes with theme/accent
  // while the token name does not.
  const [value, setValue] = useState('');
  // biome-ignore lint/correctness/useExhaustiveDependencies: re-read on theme/accent change
  useEffect(() => {
    setValue(getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim());
  }, [name, version]);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div
        className="h-14 rounded-md border border-border"
        style={{ background: `var(--${name})` }}
      />
      <code className="text-xs text-foreground-secondary">--{name}</code>
      <code className="break-all text-xs text-muted-foreground">{value || '\u00a0'}</code>
    </div>
  );
}

export default function DesignPage() {
  const [segment, setSegment] = useState('issues');
  const [select, setSelect] = useState('progress');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [checked, setChecked] = useState(true);
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 border-b border-border bg-background/90 backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-8">
          <div className="mr-auto flex items-center gap-2.5">
            <span
              className="h-5 w-5 rounded-md"
              style={{ backgroundImage: 'var(--gradient-brand)' }}
            />
            <span className="text-sm font-semibold tracking-tight">Design reference</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <AccentToggle />
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </div>
        <nav
          aria-label="Sections"
          className="flex gap-1 overflow-x-auto border-t border-border px-4 py-1.5 sm:px-8"
        >
          {SECTIONS.map(section => (
            <a
              className="shrink-0 rounded-md px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              href={`#${section.id}`}
              key={section.id}
            >
              {section.label}
            </a>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-4 pb-24 sm:px-8">
        <div className="py-10">
          <h1 className="text-3xl font-semibold tracking-tight">Token layer</h1>
          <p className="mt-3 max-w-2xl text-sm text-muted-foreground">
            Every neutral below is computed in oklch from <code>--accent-h</code>, the active
            accent&apos;s own hue — so switching the accent above retints the whole ramp, not just
            the brand roles. Each accent declares only <code>--brand</code> and{' '}
            <code>--brand-2</code>; every other brand role is derived with <code>color-mix</code>.
          </p>
        </div>

        <Section
          id="accents"
          note="The three options as the picker renders them. These are fixed values that do not follow the active accent, since the picker has to show every option at once."
          title="Accents"
        >
          <div className="grid gap-4 sm:grid-cols-3">
            {ACCENT_DEFINITIONS.map(definition => (
              <div className="flex flex-col gap-2" key={definition.id}>
                <div
                  className="h-20 rounded-lg border border-border"
                  style={{ backgroundImage: accentSwatchGradient(definition) }}
                />
                <code className="text-[11px] text-muted-foreground">{definition.id}</code>
              </div>
            ))}
          </div>
        </Section>

        <Section
          id="surfaces"
          note="--accent is the neutral hover surface, not the brand accent. It sits one deliberate step from --muted so hover feedback stays visible on any bg-muted element."
          title="Surfaces"
        >
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {SURFACE_TOKENS.map(name => (
              <Swatch key={name} name={name} />
            ))}
          </div>
        </Section>

        <Section id="ink" title="Ink">
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {INK_TOKENS.map(name => (
              <Swatch key={name} name={name} />
            ))}
          </div>
          <div className="flex flex-col gap-1 rounded-lg border border-border bg-card p-5">
            <p className="text-sm text-foreground">Primary body text on card — --foreground</p>
            <p className="text-sm text-foreground-secondary">
              Secondary text a step down — --foreground-secondary
            </p>
            <p className="text-sm text-muted-foreground">
              Muted metadata and captions — --muted-foreground
            </p>
            <p className="text-sm text-foreground-faint">
              Faint dashes and counts — --foreground-faint
            </p>
          </div>
        </Section>

        <Section
          id="brand"
          note="Brand roles follow the active accent. Semantic colours never do: they encode issue priority, workflow state and chart series, so moving them with the accent would make one colour mean two things."
          title="Brand and semantic"
        >
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
            {BRAND_TOKENS.map(name => (
              <Swatch key={name} name={name} />
            ))}
          </div>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
            {SEMANTIC_TOKENS.map(name => (
              <Swatch key={name} name={name} />
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-card p-5">
            {PRIORITIES.map(priority => (
              <span
                className="flex items-center gap-2 text-xs text-muted-foreground"
                key={priority.label}
              >
                <span
                  className="h-3 w-3 rounded-sm"
                  style={{ background: `var(${priority.token})` }}
                />
                {priority.label}
              </span>
            ))}
          </div>
        </Section>

        <Section
          id="status"
          note="Four roles plus GitHub's merged purple, each with a solid, a subtle fill and an on-subtle foreground derived by color-mix. Status roles never follow the accent."
          title="Status"
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {STATUS_ROLES.map(role => (
              <div
                className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card p-3"
                key={role}
              >
                <code className="w-20 text-xs text-muted-foreground">--{role}</code>
                <span
                  className="block h-7 w-10 rounded-md"
                  style={{ background: `var(--${role})` }}
                />
                <span
                  className="block h-7 w-10 rounded-md border border-border"
                  style={{ background: `var(--${role}-subtle)` }}
                />
                <span
                  className="rounded-full px-2.5 py-1 text-xs font-medium"
                  style={{
                    background: `var(--${role}-subtle)`,
                    color: `var(--${role}-subtle-foreground)`,
                  }}
                >
                  on-subtle
                </span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="brand">brand</Badge>
            <Badge tone="danger">danger</Badge>
            <Badge tone="warning">warning</Badge>
            <Badge tone="success">success</Badge>
            <Badge tone="info">info</Badge>
            <Badge tone="muted">muted</Badge>
            <Badge tone="outline">outline</Badge>
          </div>
        </Section>

        <Section
          id="typography"
          note="Instrument Sans for UI and display, Geist Mono for identifiers, counts and timestamps. Both are vendored latin variable subsets loaded through next/font/local, so the build never depends on a font CDN."
          title="Typography"
        >
          <div className="flex flex-col gap-5 rounded-lg border border-border bg-card p-6">
            <div>
              <code className="text-[11px] text-muted-foreground">display / 600 / -0.03em</code>
              <p className="text-3xl font-semibold tracking-tight">Cycle 24 burndown</p>
            </div>
            <div>
              <code className="text-[11px] text-muted-foreground">title / 600</code>
              <p className="text-lg font-semibold tracking-tight">
                Delta sync skips rows when committed_at ordering ties
              </p>
            </div>
            <div>
              <code className="text-[11px] text-muted-foreground">body / 400</code>
              <p className="max-w-prose text-sm text-foreground-secondary">
                The delta watermark now derives from the DB clock via a single SELECT now() per
                operation, which removed the cross-server clock-skew hazard.
              </p>
            </div>
            <div>
              <code className="text-[11px] text-muted-foreground">data / mono / tabular</code>
              <p className="font-mono text-sm tabular-nums">ENG-142 · 8 pts · 2026-08-14 · 62%</p>
              <p className="font-mono text-sm tabular-nums">ENG-99 · 13 pts · 2026-09-01 · 8%</p>
            </div>
          </div>
        </Section>

        <Section
          id="scale"
          note="Corner radii derive from --radius. Spacing follows the Tailwind 4px step; focus is a brand ring plus a soft glow rather than a 1px outline."
          title="Radius, spacing and focus"
        >
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {RADII.map(r => (
              <div className="flex flex-col gap-1.5" key={r}>
                <div
                  className="h-14 border border-border bg-muted"
                  style={{ borderRadius: `var(--radius-${r})` }}
                />
                <code className="text-xs text-muted-foreground">--radius-{r}</code>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-end gap-3">
            {SPACING.map(n => (
              <div className="flex flex-col items-center gap-1.5" key={n}>
                <span className="block bg-brand" style={{ height: 8, width: n * 4 }} />
                <code className="text-xs text-muted-foreground">{n * 4}px</code>
              </div>
            ))}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input aria-label="Focus ring specimen" placeholder="Focus an input to see the ring" />
            <Button variant="outline">Tab to see the button ring</Button>
          </div>
        </Section>

        <Section
          id="elevation"
          note="Three levels, tinted to the accent hue rather than the neutral grey Tailwind defaults, which go muddy on a dark ground."
          title="Elevation"
        >
          <div className="grid gap-5 sm:grid-cols-3">
            <div className="flex h-24 items-center justify-center rounded-lg border border-border bg-card text-xs text-muted-foreground shadow-e1">
              shadow-e1 — rows
            </div>
            <div className="flex h-24 items-center justify-center rounded-lg border border-border bg-card text-xs text-muted-foreground shadow-e2">
              shadow-e2 — popovers
            </div>
            <div className="flex h-24 items-center justify-center rounded-lg border border-border bg-card text-xs text-muted-foreground shadow-e3">
              shadow-e3 — modals
            </div>
          </div>
        </Section>

        <Section id="controls" title="Controls">
          <div className="flex flex-wrap items-center gap-3">
            <Button>Create issue</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Delete</Button>
            <Button variant="link">Link</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm">Small</Button>
            <Button>Default</Button>
            <Button size="lg">Large</Button>
            <Button disabled>Disabled</Button>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone="brand" variant="pill">
              pill
            </Badge>
            <Badge tone="brand" variant="square">
              square
            </Badge>
            <Badge tone="outline" variant="square">
              outline
            </Badge>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-center gap-3">
              <Switch checked onCheckedChange={() => {}} />
              <span className="text-sm text-muted-foreground">Switch (on)</span>
            </div>
            <div className={cn('flex items-center gap-3 text-sm text-muted-foreground', TOUCH_ROW)}>
              <Checkbox
                checked={checked}
                id="design-checkbox"
                onChange={e => setChecked(e.target.checked)}
              />
              <label htmlFor="design-checkbox">Checkbox</label>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <LanguageToggle />
            <ThemeToggle />
            <AccentToggle />
          </div>
        </Section>

        <Section
          id="forms"
          note="Label and input are paired with htmlFor; an error is announced through aria-describedby and aria-invalid."
          title="Form fields"
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <label
                className="text-sm font-medium text-foreground-secondary"
                htmlFor="design-name"
              >
                Name
              </label>
              <Input id="design-name" placeholder="Acme Inc." />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground-secondary" htmlFor="design-url">
                Workspace URL
              </label>
              <Input
                aria-describedby="design-url-error"
                aria-invalid
                defaultValue="demo"
                id="design-url"
              />
              <p
                className="text-xs text-danger-subtle-foreground"
                id="design-url-error"
                role="alert"
              >
                That URL is already taken. Try another.
              </p>
            </div>
          </div>
          <Textarea aria-label="Textarea specimen" placeholder="Textarea" rows={3} />
          <div className="grid gap-4 sm:grid-cols-2">
            <SimpleSelect
              ariaLabel="Simple select"
              onChange={setSelect}
              options={SELECT_OPTIONS}
              value={select}
            />
            <SelectPopover
              listbox
              triggerChildren={
                <span className="text-sm">
                  {SELECT_OPTIONS.find(o => o.value === select)?.label}
                </span>
              }
            >
              {close => (
                <div className="p-1">
                  {SELECT_OPTIONS.map(option => (
                    <button
                      aria-selected={option.value === select}
                      className={POPOVER_ITEM_CLASS}
                      key={option.value}
                      onClick={() => {
                        setSelect(option.value);
                        close();
                      }}
                      role="option"
                      type="button"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
            </SelectPopover>
          </div>
        </Section>

        <Section
          id="overlays"
          note="ConfirmDialog (built on the native-dialog ModalDialog) for destructive actions; toasts go through the @/lib/toast wrapper. Popovers are shown under Form fields."
          title="Dialogs and toasts"
        >
          <div className="flex flex-wrap items-center gap-3">
            <Button onClick={() => setConfirmOpen(true)} variant="destructive">
              Open confirm dialog
            </Button>
            <Button onClick={() => toast.success('Saved')} variant="outline">
              Success toast
            </Button>
            <Button onClick={() => toast.error('Could not save')} variant="outline">
              Error toast
            </Button>
          </div>
          <ConfirmDialog
            message="This permanently deletes the issue."
            onCancel={() => setConfirmOpen(false)}
            onConfirm={() => setConfirmOpen(false)}
            open={confirmOpen}
            title="Delete issue?"
          />
        </Section>

        <Section
          id="layout"
          note="PageHeader is the single page-chrome header; EmptyState covers 'nothing here yet' in both page and compact sub-section sizes; SectionCard frames titled groups; InlineRetry is the failed-to-load affordance for supplementary sections."
          title="Layout and states"
        >
          <div className="overflow-hidden rounded-lg border border-border">
            <PageHeader
              actions={<Button size="sm">New issue</Button>}
              count={24}
              description="Everything assigned to your team"
              title="Issues"
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-card">
              <EmptyState
                action={<Button size="sm">Create issue</Button>}
                description="Issues you create will show up here."
                icon={<Inbox className="h-5 w-5" />}
                title="No issues yet"
              />
            </div>
            <div className="flex flex-col gap-4">
              <EmptyState size="compact" title="No labels" />
              <SectionCard description="One-line explanation" title="Section card">
                <InlineRetry message="Couldn't load activity" onRetry={() => {}} />
              </SectionCard>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <UserAvatar
              size="md"
              user={{
                avatarBackgroundColor: 'var(--brand)',
                displayName: 'Ada Lovelace',
                initials: 'AL',
              }}
            />
            <span className="text-sm text-muted-foreground">UserAvatar</span>
          </div>
        </Section>

        <Section
          id="indicators"
          note="Small shared primitives. ProgressBar takes its track size from className and its fill defaults to bg-brand; ColorDot renders a caller-supplied entity colour (label/workflow-state swatches) so it is deliberately not tokenised."
          title="Indicators"
        >
          <div className="flex max-w-md flex-col gap-3">
            <ProgressBar className="h-2" value={30} />
            <ProgressBar className="h-2" fillClassName="bg-success" value={72} />
            <ProgressBar className="h-1.5 w-16" value={100} />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <span className="flex items-center gap-1.5 text-sm text-foreground-secondary">
              <ColorDot color="var(--brand)" size="md" /> md
            </span>
            <span className="flex items-center gap-1.5 text-sm text-foreground-secondary">
              <ColorDot color="var(--success)" size="sm" /> sm
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedControl
              onChange={setSegment}
              options={[
                { label: 'Issues', value: 'issues' },
                { label: 'Points', value: 'points' },
              ]}
              value={segment}
            />
            <SegmentedControl
              onChange={setSegment}
              options={[
                { label: 'Issues', value: 'issues' },
                { label: 'Points', value: 'points' },
              ]}
              size="md"
              value={segment}
            />
          </div>
        </Section>

        <Section
          id="loading"
          note="Lists, boards and panels render a shaped skeleton while their data loads, never a centred loading string."
          title="Loading"
        >
          <div className="flex flex-col gap-2.5 rounded-lg border border-border bg-card p-5">
            <Skeleton className="h-3 w-2/5" />
            <Skeleton className="h-3 w-11/12" />
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-3 w-5/6" />
          </div>
        </Section>
      </main>
    </div>
  );
}
