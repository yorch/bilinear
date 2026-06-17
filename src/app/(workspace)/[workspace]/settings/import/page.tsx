'use client';

import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { gql } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

const PREVIEW_QUERY = `
  query CsvImportPreview($csv: String!) {
    csvImportPreview(csv: $csv) { headers rowCount sampleRows }
  }
`;

const IMPORT_MUTATION = `
  mutation CsvImportIssues($input: CsvImportInput!) {
    csvImportIssues(input: $input) { success created skipped errors }
  }
`;

const EXPORT_QUERY = `
  query OrganizationExport($teamId: ID) { organizationExport(teamId: $teamId) }
`;

// Mappable issue fields → label. `title` is required; the rest optional.
const MAPPABLE_FIELDS = [
  { key: 'title', label: 'Title', required: true },
  { key: 'description', label: 'Description', required: false },
  { key: 'priority', label: 'Priority', required: false },
  { key: 'assignee', label: 'Assignee (email)', required: false },
  { key: 'state', label: 'Status (name)', required: false },
] as const;

type FieldKey = (typeof MAPPABLE_FIELDS)[number]['key'];

interface ImportResult {
  created: number;
  errors: string[];
  skipped: number;
}

const ImportSettingsPage = observer(function ImportSettingsPage() {
  const { teamStore } = useStore();
  const teams = teamStore.all;

  const [csv, setCsv] = useState('');
  const [teamId, setTeamId] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rowCount, setRowCount] = useState(0);
  const [mapping, setMapping] = useState<Partial<Record<FieldKey, string>>>({});
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const activeTeamId = teamId || teams[0]?.id || '';

  // Best-effort auto-map by case-insensitive header name match.
  function autoMap(hdrs: string[]) {
    const next: Partial<Record<FieldKey, string>> = {};
    for (const f of MAPPABLE_FIELDS) {
      const hit = hdrs.find(
        h => h.toLowerCase() === f.key || h.toLowerCase() === f.label.toLowerCase(),
      );
      if (hit) {
        next[f.key] = hit;
      }
    }
    return next;
  }

  async function handleFile(file: File) {
    const text = await file.text();
    setCsv(text);
    await runPreview(text);
  }

  async function runPreview(text: string) {
    if (!text.trim()) {
      return;
    }
    try {
      const res = await gql(PREVIEW_QUERY, { csv: text });
      const data = (res.data as { csvImportPreview?: { headers: string[]; rowCount: number } })
        ?.csvImportPreview;
      if (data) {
        setHeaders(data.headers);
        setRowCount(data.rowCount);
        setMapping(autoMap(data.headers));
        setResult(null);
      }
    } catch {
      toast.error('Could not parse CSV');
    }
  }

  async function runImport() {
    if (!activeTeamId) {
      toast.error('Select a team');
      return;
    }
    if (!mapping.title) {
      toast.error('Map the Title column');
      return;
    }
    setImporting(true);
    try {
      const res = await gql(IMPORT_MUTATION, {
        input: { csv, mapping, teamId: activeTeamId },
      });
      const data = (res.data as { csvImportIssues?: ImportResult })?.csvImportIssues;
      if (data) {
        setResult(data);
        toast.success(`Imported ${data.created} issue(s)`);
      }
    } catch (err) {
      toast.error((err as Error).message || 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  async function runExport() {
    try {
      const res = await gql(EXPORT_QUERY, { teamId: activeTeamId || null });
      const json = (res.data as { organizationExport?: string })?.organizationExport;
      if (!json) {
        return;
      }
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.download = 'bilinear-export.json';
      a.href = url;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error('Export failed');
    }
  }

  const inputCls = cn(
    'rounded-md border border-zinc-200 dark:border-zinc-700 bg-transparent',
    'px-2 py-1 text-sm text-zinc-900 dark:text-zinc-100',
    'focus:outline-none focus:ring-1 focus:ring-indigo-500',
  );

  return (
    <div className="mx-auto max-w-2xl space-y-8 p-8">
      <div>
        <h1 className="text-xl font-semibold">Import / Export</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Import issues from a CSV file, or export your data as JSON.
        </p>
      </div>

      {/* Import */}
      <section className="rounded-lg border p-6 space-y-4">
        <h2 className="font-medium">Import issues from CSV</h2>

        <div className="flex flex-wrap items-center gap-3">
          <input
            accept=".csv,text/csv"
            className="text-sm"
            onChange={e => {
              const f = e.target.files?.[0];
              if (f) {
                void handleFile(f);
              }
            }}
            type="file"
          />
          <select
            className={inputCls}
            onChange={e => setTeamId(e.target.value)}
            value={activeTeamId}
          >
            {teams.length === 0 && <option value="">No teams</option>}
            {teams.map(t => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>

        {headers.length > 0 && (
          <>
            <p className="text-xs text-muted-foreground">
              {rowCount} row(s) detected. Map columns to issue fields:
            </p>
            <div className="space-y-2">
              {MAPPABLE_FIELDS.map(f => (
                <label className="flex items-center justify-between gap-3" key={f.key}>
                  <span className="text-sm">
                    {f.label}
                    {f.required && <span className="text-destructive"> *</span>}
                  </span>
                  <select
                    className={inputCls}
                    onChange={e =>
                      setMapping(m => ({ ...m, [f.key]: e.target.value || undefined }))
                    }
                    value={mapping[f.key] ?? ''}
                  >
                    <option value="">— none —</option>
                    {headers.map(h => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <button
              className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              disabled={importing || !mapping.title}
              onClick={() => void runImport()}
              type="button"
            >
              {importing ? 'Importing…' : `Import ${rowCount} issue(s)`}
            </button>
          </>
        )}

        {result && (
          <div className="rounded-md bg-muted/50 p-3 text-sm">
            <p>
              Created <strong>{result.created}</strong>, skipped <strong>{result.skipped}</strong>.
            </p>
            {result.errors.length > 0 && (
              <ul className="mt-2 max-h-40 list-disc overflow-auto pl-5 text-xs text-destructive">
                {result.errors.map(e => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      {/* Export */}
      <section className="rounded-lg border p-6 space-y-3">
        <h2 className="font-medium">Export</h2>
        <p className="text-sm text-muted-foreground">
          Download a JSON snapshot of issues for the selected team (or all teams).
        </p>
        <button
          className="rounded-md border px-4 py-1.5 text-sm hover:bg-muted"
          onClick={() => void runExport()}
          type="button"
        >
          Export JSON
        </button>
      </section>
    </div>
  );
});

export default ImportSettingsPage;
