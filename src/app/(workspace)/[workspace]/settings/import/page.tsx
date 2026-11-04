'use client';

import { observer } from 'mobx-react-lite';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { SimpleSelect } from '@/components/ui/select';
import { RowsSkeleton } from '@/components/ui/skeleton';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useTranslations } from '@/hooks/use-translations';
import { gqlMutate, gqlQuery } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { getErrorMessage } from '@/lib/utils';
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
  // Import has NO default team: silently filing a CSV into whichever team
  // happens to be first is how issues end up in the wrong place.
  const [teamId, setTeamId] = useState('');
  const [fileName, setFileName] = useState('');
  const [exportTeamId, setExportTeamId] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rowCount, setRowCount] = useState(0);
  const [mapping, setMapping] = useState<Partial<Record<FieldKey, string>>>({});
  const [importing, setImporting] = useState(false);
  // The preview parses the whole CSV server-side; on a large file that is
  // long enough that a silent gap read as "the picker did nothing".
  const [previewing, setPreviewing] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const activeTeamId = teamId;

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

  function downloadTemplate() {
    const header = MAPPABLE_FIELDS.map(f => MAPPABLE_FIELD_MATCH_LABELS[f.key]).join(',');
    const blob = new Blob([`${header}\n`], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.download = 'bilinear-import-template.csv';
    a.href = url;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function handleFile(file: File) {
    setFileName(file.name);
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
        { teamId: exportTeamId || null },
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

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <PageHeader
        description={t('settings.import.description')}
        title={t('settings.import.title')}
      />
      <div className="mx-auto w-full max-w-2xl space-y-8 px-4 py-6 md:p-8">
        {/* Import */}
        <section className="space-y-4 rounded-lg border border-border bg-card p-4 md:p-6">
          <h2 className="font-medium">{t('settings.import.importHeading')}</h2>
          <p className="text-xs text-muted-foreground">{t('settings.import.columnsHint')}</p>

          <div className="space-y-3">
            <div>
              <span className="mb-1 block text-sm font-medium">
                {t('settings.import.importIntoTeam')} <span className="text-danger">*</span>
              </span>
              <SimpleSelect
                ariaLabel={t('settings.import.importIntoTeam')}
                onChange={setTeamId}
                options={teams.map(team => ({ label: team.name, value: team.id }))}
                placeholder={
                  teams.length === 0
                    ? t('settings.import.noTeams')
                    : t('settings.import.chooseTeam')
                }
                value={activeTeamId}
              />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <input
                accept=".csv,text/csv"
                aria-label={t('settings.import.csvFile')}
                className="sr-only"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) {
                    void handleFile(f);
                  }
                }}
                ref={fileInputRef}
                tabIndex={-1}
                type="file"
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                size="sm"
                type="button"
                variant="outline"
              >
                {t('settings.import.chooseCsv')}
              </Button>
              <span className="min-w-0 truncate text-sm text-muted-foreground">
                {fileName || t('settings.import.noFileChosen')}
              </span>
              <Button
                className="ml-auto"
                onClick={downloadTemplate}
                size="sm"
                type="button"
                variant="ghost"
              >
                {t('settings.import.downloadTemplate')}
              </Button>
            </div>
          </div>

          {previewing && <RowsSkeleton count={3} />}

          {!previewing && headers.length > 0 && (
            <>
              <p className="text-xs text-muted-foreground">
                {t('settings.import.rowsDetected', { count: rowCount })}
              </p>
              <div className="space-y-2">
                {MAPPABLE_FIELDS.map(f => (
                  <div className="flex items-center justify-between gap-3" key={f.key}>
                    <span className="text-sm">
                      {t(f.labelKey)}
                      {f.required && <span className="text-danger"> *</span>}
                    </span>
                    <SimpleSelect
                      ariaLabel={t(f.labelKey)}
                      className="w-48 max-w-[55%]"
                      onChange={value => setMapping(m => ({ ...m, [f.key]: value || undefined }))}
                      options={[
                        { label: t('settings.import.noneOption'), value: '' },
                        ...headers.map(h => ({ label: h, value: h })),
                      ]}
                      value={mapping[f.key] ?? ''}
                    />
                  </div>
                ))}
              </div>
              <Button
                disabled={importing || !mapping.title || !activeTeamId}
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
                <ul className="mt-2 max-h-40 list-disc overflow-auto pl-5 text-xs text-danger-subtle-foreground">
                  {result.errors.map(e => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        {/* Export */}
        <section className="space-y-3 rounded-lg border border-border bg-card p-4 md:p-6">
          <h2 className="font-medium">{t('settings.import.exportHeading')}</h2>
          <p className="text-sm text-muted-foreground">{t('settings.import.exportDescription')}</p>
          <div>
            <span className="mb-1 block text-sm font-medium">
              {t('settings.import.exportTeam')}
            </span>
            <SimpleSelect
              ariaLabel={t('settings.import.exportTeam')}
              onChange={setExportTeamId}
              options={[
                { label: t('settings.import.allTeams'), value: '' },
                ...teams.map(team => ({ label: team.name, value: team.id })),
              ]}
              value={exportTeamId}
            />
          </div>
          <Button onClick={() => void runExport()} size="sm" type="button" variant="outline">
            {t('settings.import.exportJson')}
          </Button>
        </section>
      </div>
    </div>
  );
});

export default ImportSettingsPage;
