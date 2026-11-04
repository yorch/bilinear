'use client';

import { ExternalLink } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import { InlineRetry } from '@/components/shared/inline-retry';
import { SettingToggleRow } from '@/components/shared/setting-toggle-row';
import { Button } from '@/components/ui/button';
import { ColorDot } from '@/components/ui/color-dot';
import { Input } from '@/components/ui/input';
import { PageHeader } from '@/components/ui/page-header';
import { RowsSkeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { useRetryableFetch } from '@/hooks/use-retryable-fetch';
import { useTranslations } from '@/hooks/use-translations';
import { gqlMutate, gqlQuery } from '@/lib/graphql';
import { toast } from '@/lib/toast';
import { getErrorMessage } from '@/lib/utils';
import { useStore } from '@/providers/store-provider';

const PUBLIC_ROADMAP_QUERY = `
  query PublicRoadmap {
    publicRoadmap {
      id
      description
      enabled
      hasPassword
      slug
      title
    }
  }
`;

const UPSERT_ROADMAP_MUTATION = `
  mutation PublicRoadmapUpsert($input: PublicRoadmapUpsertInput!) {
    publicRoadmapUpsert(input: $input) {
      lastSyncId
      roadmap {
        id
        description
        enabled
        hasPassword
        slug
        title
      }
      success
    }
  }
`;

const SET_ROADMAP_VISIBLE_MUTATION = `
  mutation ProjectSetRoadmapVisible($id: ID!, $visible: Boolean!) {
    projectSetRoadmapVisible(id: $id, visible: $visible) {
      lastSyncId
      success
    }
  }
`;

interface RoadmapSettings {
  description: string | null;
  enabled: boolean;
  hasPassword: boolean;
  id: string;
  slug: string;
  title: string;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const RoadmapSettingsPage = observer(function RoadmapSettingsPage() {
  const t = useTranslations();
  useDocumentTitle(t('roadmap.settings.title'));
  const { projectStore, syncStore } = useStore();
  const { workspace } = useParams<{ workspace: string }>();

  const [saving, setSaving] = useState(false);
  const [togglingProjectId, setTogglingProjectId] = useState<string | null>(null);

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [slug, setSlug] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [clearPassword, setClearPassword] = useState(false);

  const {
    data: roadmap,
    error: loadError,
    loading,
    refetch: loadRoadmap,
    setData: setRoadmap,
  } = useRetryableFetch<RoadmapSettings | null>(
    // `publicRoadmap` is a nullable root: a failed query answers HTTP 200 with
    // the field null *alongside* `errors`, which would render the blank
    // "create a roadmap" form for a roadmap that is already publicly live —
    // and saving it would overwrite the real settings. gqlQuery throws
    // instead, so the blank form only shows for a genuine null.
    () => gqlQuery<RoadmapSettings | null>(PUBLIC_ROADMAP_QUERY, {}, 'publicRoadmap'),
    [],
    null,
    {
      onData: r => {
        if (r) {
          setTitle(r.title);
          setDescription(r.description ?? '');
          setSlug(r.slug);
          setEnabled(r.enabled);
        } else {
          // No roadmap yet: start from real values (the org name and the
          // workspace key) instead of greyed placeholders that look filled in
          // and then fail the required check on save.
          setTitle(syncStore.organizationName ?? '');
          setSlug(slugify(workspace ?? ''));
        }
      },
    },
  );

  // Plain getter — observer() tracks the read so updates flow through
  // without a memo whose `.size` dep would miss in-place mutations.
  const projects = projectStore.all;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const input: Record<string, unknown> = {
        description: description || null,
        enabled,
        slug,
        title,
      };
      if (clearPassword) {
        input.password = '';
      } else if (newPassword) {
        input.password = newPassword;
      }
      // gqlMutate throws on a slug collision / BAD_USER_INPUT cap, so neither
      // the success toast nor the form reset can run for a rejected save.
      const data = (await gqlMutate(UPSERT_ROADMAP_MUTATION, { input })) as {
        publicRoadmapUpsert?: {
          roadmap?: RoadmapSettings;
          success: boolean;
        };
      };
      const r = data.publicRoadmapUpsert?.roadmap;
      if (!r) {
        toast.error(t('roadmap.settings.saveError'));
        return;
      }
      setRoadmap(r);
      setTitle(r.title);
      setDescription(r.description ?? '');
      setSlug(r.slug);
      setEnabled(r.enabled);
      setNewPassword('');
      setClearPassword(false);
      toast.success(t('roadmap.settings.saveSuccess'));
    } catch (err) {
      toast.error(getErrorMessage(err, t('roadmap.settings.saveError')));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleProject = async (projectId: string, currentlyVisible: boolean) => {
    setTogglingProjectId(projectId);
    try {
      await gqlMutate(SET_ROADMAP_VISIBLE_MUTATION, {
        id: projectId,
        visible: !currentlyVisible,
      });
      toast.success(
        currentlyVisible
          ? t('roadmap.settings.projectRemoved')
          : t('roadmap.settings.projectAdded'),
      );
    } catch (err) {
      toast.error(getErrorMessage(err, t('roadmap.settings.projectUpdateError')));
    } finally {
      setTogglingProjectId(null);
    }
  };

  const roadmapUrl = roadmap ? `/roadmap/${roadmap.slug}` : null;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <PageHeader
        description={t('roadmap.settings.description')}
        title={t('roadmap.settings.title')}
      />

      <div className="mx-auto w-full max-w-2xl px-6 py-8 flex flex-col gap-8">
        {/* Settings form */}
        <section>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('roadmap.settings.sectionHeading')}
          </h2>
          <div className="rounded-lg border border-border bg-card p-5">
            {loading ? (
              <RowsSkeleton count={2} />
            ) : loadError ? (
              <InlineRetry
                message={t('common.somethingWentWrong')}
                onRetry={() => void loadRoadmap()}
              />
            ) : (
              <form className="flex flex-col gap-5" onSubmit={handleSave}>
                {/* Enabled toggle */}
                <SettingToggleRow
                  checked={enabled}
                  description={t('roadmap.settings.publicRoadmapDescription')}
                  label={t('roadmap.settings.publicRoadmap')}
                  onCheckedChange={setEnabled}
                />

                {!enabled && (
                  <p className="-mt-2 text-xs text-muted-foreground">
                    {t('roadmap.settings.offHint')}
                  </p>
                )}

                {/* Title */}
                <div className="flex flex-col gap-1">
                  <label
                    className="text-xs font-medium text-muted-foreground"
                    htmlFor="roadmap-title"
                  >
                    {t('roadmap.settings.titleLabel')}
                  </label>
                  <Input
                    id="roadmap-title"
                    onChange={e => setTitle(e.target.value)}
                    placeholder={t('roadmap.settings.titlePlaceholder')}
                    required
                    type="text"
                    value={title}
                  />
                </div>

                {/* Description */}
                <div className="flex flex-col gap-1">
                  <label
                    className="text-xs font-medium text-muted-foreground"
                    htmlFor="roadmap-description"
                  >
                    {t('roadmap.settings.descriptionLabel')}
                  </label>
                  <Textarea
                    className="resize-none"
                    id="roadmap-description"
                    onChange={e => setDescription(e.target.value)}
                    placeholder={t('roadmap.settings.descriptionPlaceholder')}
                    rows={2}
                    value={description}
                  />
                </div>

                {/* Slug */}
                <div className="flex flex-col gap-1">
                  <label
                    className="text-xs font-medium text-muted-foreground"
                    htmlFor="roadmap-slug"
                  >
                    {t('roadmap.settings.slugLabel')}
                  </label>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground shrink-0">/roadmap/</span>
                    <Input
                      className="flex-1 font-mono"
                      id="roadmap-slug"
                      onChange={e => setSlug(e.target.value)}
                      pattern="[a-z0-9-]+"
                      placeholder={t('roadmap.settings.slugPlaceholder')}
                      required
                      type="text"
                      value={slug}
                    />
                  </div>
                  {roadmapUrl && (
                    <Link
                      className="flex items-center gap-1 text-xs text-brand hover:text-brand-hover"
                      href={roadmapUrl}
                      rel="noopener noreferrer"
                      target="_blank"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {t('roadmap.settings.viewPublicRoadmap')}
                    </Link>
                  )}
                </div>

                {/* Password */}
                <div className="flex flex-col gap-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    {t('roadmap.settings.passwordProtection')}
                  </p>
                  {roadmap?.hasPassword && !clearPassword ? (
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground">
                        {t('roadmap.settings.passwordIsSet')}
                      </span>
                      <button
                        className="text-xs text-danger-subtle-foreground hover:underline"
                        onClick={() => {
                          setNewPassword('');
                          setClearPassword(true);
                        }}
                        type="button"
                      >
                        {t('roadmap.settings.removePassword')}
                      </button>
                    </div>
                  ) : (
                    <>
                      {clearPassword && (
                        <p className="text-xs text-warning-subtle-foreground">
                          {t('roadmap.settings.passwordWillBeRemoved')}{' '}
                          <button
                            className="underline"
                            onClick={() => setClearPassword(false)}
                            type="button"
                          >
                            {t('common.cancel')}
                          </button>
                        </p>
                      )}
                      {!clearPassword && (
                        <>
                          <label className="sr-only" htmlFor="roadmap-password">
                            {t('roadmap.settings.newPassword')}
                          </label>
                          <Input
                            autoComplete="new-password"
                            id="roadmap-password"
                            onChange={e => setNewPassword(e.target.value)}
                            placeholder={t('roadmap.settings.newPasswordPlaceholder')}
                            type="password"
                            value={newPassword}
                          />
                        </>
                      )}
                    </>
                  )}
                </div>

                <div className="flex justify-end">
                  <Button disabled={saving} type="submit">
                    {saving ? t('common.saving') : t('roadmap.settings.saveSettings')}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </section>

        {/* Projects */}
        <section>
          <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('roadmap.settings.projectsHeading')}
          </h2>
          <p className="mb-4 text-xs text-muted-foreground">
            {t('roadmap.settings.projectsDescription')}
          </p>
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            {projects.length === 0 ? (
              <p className="px-5 py-4 text-sm text-muted-foreground">
                {t('roadmap.settings.noActiveProjects')}
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {projects.map(project => {
                  const isToggling = togglingProjectId === project.id;
                  return (
                    <li className="flex items-center gap-3 px-5 py-3" key={project.id}>
                      <ColorDot className="h-3 w-3" color={project.color} />
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {project.name}
                        </p>
                        <p className="truncate text-xs text-muted-foreground capitalize">
                          {project.statusType.replace(/([A-Z])/g, ' $1').trim()}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {project.roadmapVisible
                          ? t('roadmap.settings.visible')
                          : t('roadmap.settings.hidden')}
                      </span>
                      <Switch
                        aria-label={`${project.name}: ${
                          project.roadmapVisible
                            ? t('roadmap.settings.removeFromRoadmap')
                            : t('roadmap.settings.addToRoadmap')
                        }`}
                        checked={project.roadmapVisible}
                        disabled={isToggling}
                        onCheckedChange={() =>
                          handleToggleProject(project.id, project.roadmapVisible)
                        }
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </section>
      </div>
    </div>
  );
});

export default RoadmapSettingsPage;
