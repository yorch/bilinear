'use client';

import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { RowsSkeleton } from '@/components/ui/skeleton';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useTranslations } from '@/hooks/use-translations';
import { gqlMutate, gqlQuery } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { cn, getErrorMessage } from '@/lib/utils';
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
  { key: 'title', labelKey: 'settings.import.fieldTitle', required: true },
  { key: 'description', labelKey: 'settings.import.fieldDescription', required: false },
  { key: 'priority', labelKey: 'settings.import.fieldPriority', required: false },
  { key: 'assignee', labelKey: 'settings.import.fieldAssignee', required: false },
  { key: 'state', labelKey: 'settings.import.fieldState', required: false },
] as const;

type FieldKey = (typeof MAPPABLE_FIELDS)[number]['key'];

// English header names used for best-effort auto-mapping against CSV headers.
// Not translated — this matches literal CSV column names, not display text.
const MAPPABLE_FIELD_MATCH_LABELS: Record<FieldKey, string> = {
  assignee: 'Assignee (email)',
  description: 'Description',
  priority: 'Priority',
  state: 'Status (name)',
  title: 'Title',
};

interface ImportResult {
  created: number;
  errors: string[];
  skipped: number;
}

const ImportSettingsPage = observer(function ImportSettingsPage() {
  const t = useTranslations();
  useDocumentTitle(t('settings.import.title'));
  const { teamStore } = useStore();
  const teams = teamStore.all;

  const [csv, setCsv] = useState('');
  const [teamId, setTeamId] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [rowCount, setRowCount] = useState(0);
  const [mapping, setMapping] = useState<Partial<Record<FieldKey, string>>>({});
  const [importing, setImporting] = useState(false);
  // The preview parses the whole CSV server-side; on a large file that is
  // long enough that a silent gap read as "the picker did nothing".
  const [previewing, setPreviewing] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const activeTeamId = teamId || teams[0]?.id || '';

  // Best-effort auto-map by case-insensitive header name match.
  function autoMap(hdrs: string[]) {
    const next: Partial<Record<FieldKey, string>> = {};
    for (const f of MAPPABLE_FIELDS) {
      const hit = hdrs.find(
        h =>
          h.toLowerCase() === f.key ||
          h.toLowerCase() === MAPPABLE_FIELD_MATCH_LABELS[f.key].toLowerCase(),
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
    setPreviewing(true);
    try {
      const data = await gqlQuery<{ headers: string[]; rowCount: number } | null>(
        PREVIEW_QUERY,
        { csv: text },
        'csvImportPreview',
      );
      if (!data) {
        toast.error(t('settings.import.couldNotParseCsv'));
        return;
      }
      setHeaders(data.headers);
      setRowCount(data.rowCount);
      setMapping(autoMap(data.headers));
      setResult(null);
    } catch (err) {
      toast.error(getErrorMessage(err, t('settings.import.couldNotParseCsv')));
    } finally {
      setPreviewing(false);
    }
  }

  async function runImport() {
    if (!activeTeamId) {
      toast.error(t('settings.import.selectTeam'));
      return;
    }
    if (!mapping.title) {
      toast.error(t('settings.import.mapTitleColumn'));
      return;
    }
    setImporting(true);
    try {
      const data = (
        (await gqlMutate(IMPORT_MUTATION, {
          input: { csv, mapping, teamId: activeTeamId },
        })) as { csvImportIssues?: ImportResult }
      ).csvImportIssues;
      if (!data) {
        toast.error(t('settings.import.importFailed'));
        return;
      }
      setResult(data);
      toast.success(t('settings.import.importedCount', { count: data.created }));
    } catch (err) {
      toast.error(getErrorMessage(err, t('settings.import.importFailed')));
    } finally {
      setImporting(false);
    }
  }

  async function runExport() {
    try {
      // `organizationExport` is org-admin only: a non-admin gets HTTP 200 with a
      // FORBIDDEN error, which used to bail out silently (no download, no toast).
      const json = await gqlQuery<string | null>(
        EXPORT_QUERY,
        { teamId: activeTeamId || null },
        'organizationExport',
      );
      if (!json) {
        toast.error(t('settings.import.exportFailed'));
        return;
      }
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.download = 'bilinear-export.json';
      a.href = url;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(getErrorMessage(err, t('settings.import.exportFailed')));
    }
  }

  const inputCls = cn(
    'rounded-md border border-border bg-transparent',
    'px-2 py-1 text-sm text-foreground',
    'focus:outline-none focus:ring-1 focus:ring-brand',
  );

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <PageHeader
        description={t('settings.import.description')}
        title={t('settings.import.title')}
      />
      <div className="mx-auto w-full max-w-2xl space-y-8 p-8">
        {/* Import */}
        <section className="rounded-lg border p-6 space-y-4">
          <h2 className="font-medium">{t('settings.import.importHeading')}</h2>

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
              {teams.length === 0 && <option value="">{t('settings.import.noTeams')}</option>}
              {teams.map(team => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
            </select>
          </div>

          {previewing && <RowsSkeleton count={3} />}

          {!previewing && headers.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground">
                {t('settings.import.rowsDetected', { count: rowCount })}
              </p>
              <div className="space-y-2">
                {MAPPABLE_FIELDS.map(f => (
                  <label className="flex items-center justify-between gap-3" key={f.key}>
                    <span className="text-sm">
                      {t(f.labelKey)}
                      {f.required && <span className="text-destructive"> *</span>}
                    </span>
                    <select
                      className={inputCls}
                      onChange={e =>
                        setMapping(m => ({ ...m, [f.key]: e.target.value || undefined }))
                      }
                      value={mapping[f.key] ?? ''}
                    >
                      <option value="">{t('settings.import.noneOption')}</option>
                      {headers.map(h => (
                        <option key={h} value={h}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <Button
                disabled={importing || !mapping.title}
                onClick={() => void runImport()}
                size="sm"
                type="button"
              >
                {importing
                  ? t('settings.import.importingEllipsis')
                  : t('settings.import.importCount', { count: rowCount })}
              </Button>
            </>
          )}

          {result && (
            <div className="rounded-md bg-muted/50 p-3 text-sm">
              <p>
                {t('settings.import.createdSkipped', {
                  created: result.created,
                  skipped: result.skipped,
                })}
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
          <h2 className="font-medium">{t('settings.import.exportHeading')}</h2>
          <p className="text-sm text-muted-foreground">{t('settings.import.exportDescription')}</p>
          <Button onClick={() => void runExport()} size="sm" type="button" variant="outline">
            {t('settings.import.exportJson')}
          </Button>
        </section>
      </div>
    </div>
  );
});

export default ImportSettingsPage;
