interface StatCardProps {
  label: string;
  /** Always rendered (empty when absent) so a row of tiles keeps one height. */
  sub?: string;
  value: string | number;
}

/** One headline figure on an analytics page. */
export function StatCard({ label, value, sub }: StatCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
      <p className="mt-0.5 min-h-4 text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}
