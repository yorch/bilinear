'use client';

import { AccentToggle } from '@/components/accent-toggle';
import { ThemeToggle } from '@/components/theme-toggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ACCENT_DEFINITIONS, accentSwatchGradient } from '@/lib/accent';

/**
 * Design-system reference route (`/design`).
 *
 * Deliberately not translated and not behind the workspace shell: this is an
 * internal reference for verifying the token layer in a real browser. It reads
 * the live document tokens, so switching accent or theme with the controls at
 * the top re-renders every specimen below.
 */

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

const PRIORITIES = [
  { label: 'Urgent', token: '--priority-urgent' },
  { label: 'High', token: '--priority-high' },
  { label: 'Medium', token: '--priority-medium' },
  { label: 'Low', token: '--priority-low' },
  { label: 'None', token: '--priority-none' },
];

function Section({
  children,
  note,
  title,
}: {
  children: React.ReactNode;
  note?: string;
  title: string;
}) {
  return (
    <section className="flex flex-col gap-4 border-t border-border py-10">
      <div className="flex flex-col gap-1.5">
        <h2 className="text-lg font-semibold tracking-tight text-foreground">{title}</h2>
        {note && <p className="max-w-2xl text-sm text-muted-foreground">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function Swatch({ name }: { name: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="h-14 rounded-md border border-border"
        style={{ background: `var(--${name})` }}
      />
      <code className="text-[11px] text-muted-foreground">--{name}</code>
    </div>
  );
}

export default function DesignPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-4 border-b border-border bg-background/80 px-8 py-3 backdrop-blur">
        <div className="mr-auto flex items-center gap-2.5">
          <span
            className="h-5 w-5 rounded-md"
            style={{ backgroundImage: 'var(--gradient-brand)' }}
          />
          <span className="text-sm font-semibold tracking-tight">Design reference</span>
        </div>
        <AccentToggle />
        <ThemeToggle />
      </header>

      <main className="mx-auto max-w-5xl px-8 pb-24">
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
          note="The three options as the picker renders them. Unlike --brand these are fixed values that do not follow the active accent, since the picker has to show every option at once."
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
          note="--accent is the neutral hover surface, not the brand accent. It used to be byte-identical to --muted, which silently erased hover feedback on any bg-muted element; it now sits one deliberate step apart."
          title="Surfaces"
        >
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            {SURFACE_TOKENS.map(name => (
              <Swatch key={name} name={name} />
            ))}
          </div>
        </Section>

        <Section title="Ink">
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

        <Section title="Controls">
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
            <Badge className="bg-brand-subtle text-brand-subtle-foreground">brand</Badge>
            <Badge className="bg-muted text-muted-foreground">muted</Badge>
            <Badge className="border border-border text-foreground-secondary">outline</Badge>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Input placeholder="Focus me to see the ring" />
            <div className="flex items-center gap-3">
              <Switch checked onCheckedChange={() => {}} />
              <span className="text-sm text-muted-foreground">Switch (on)</span>
            </div>
          </div>
          <Textarea placeholder="Textarea" rows={3} />
        </Section>

        <Section
          note="Skeleton exists in the codebase but is imported in only two files; the main pages still render a centred loading string. Every list, board and panel should use a shaped skeleton instead."
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
