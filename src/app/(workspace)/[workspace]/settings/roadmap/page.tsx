'use client';

import { ExternalLink, Eye, EyeOff } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { SettingToggleRow } from '@/components/shared/setting-toggle-row';
import { useTranslations } from '@/hooks/use-translations';
import { gql } from '@/lib/graphql';
import { toast } from '@/lib/toast';
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

const RoadmapSettingsPage = observer(function RoadmapSettingsPage() {
  const t = useTranslations();
  const { projectStore } = useStore();

  const [roadmap, setRoadmap] = useState<RoadmapSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [togglingProjectId, setTogglingProjectId] = useState<string | null>(null);

  // Form state
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [slug, setSlug] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [clearPassword, setClearPassword] = useState(false);

  useEffect(() => {
    let cancelled = false;
    gql(PUBLIC_ROADMAP_QUERY)
      .then(result => {
        if (cancelled) {
          return;
        }
        const data = result.data as { publicRoadmap?: RoadmapSettings | null } | undefined;
        if (data?.publicRoadmap) {
          const r = data.publicRoadmap;
          setRoadmap(r);
          setTitle(r.title);
          setDescription(r.description ?? '');
          setSlug(r.slug);
          setEnabled(r.enabled);
        }
      })
      .catch(() => {
        /* degrade gracefully */
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
      const result = await gql(UPSERT_ROADMAP_MUTATION, { input });
      const data = result.data as
        | {
            publicRoadmapUpsert?: {
              roadmap?: RoadmapSettings;
              success: boolean;
            };
          }
        | undefined;
      if (data?.publicRoadmapUpsert?.roadmap) {
        const r = data.publicRoadmapUpsert.roadmap;
        setRoadmap(r);
        setTitle(r.title);
        setDescription(r.description ?? '');
        setSlug(r.slug);
        setEnabled(r.enabled);
        setNewPassword('');
        setClearPassword(false);
      }
      toast.success(t('roadmap.settings.saveSuccess'));
    } catch {
      toast.error(t('roadmap.settings.saveError'));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleProject = async (projectId: string, currentlyVisible: boolean) => {
    setTogglingProjectId(projectId);
    try {
      await gql(SET_ROADMAP_VISIBLE_MUTATION, {
        id: projectId,
        visible: !currentlyVisible,
      });
      toast.success(
        currentlyVisible
          ? t('roadmap.settings.projectRemoved')
          : t('roadmap.settings.projectAdded'),
      );
    } catch {
      toast.error(t('roadmap.settings.projectUpdateError'));
    } finally {
      setTogglingProjectId(null);
    }
  };

  const roadmapUrl = roadmap ? `/roadmap/${roadmap.slug}` : null;

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <div className="flex items-center border-b border-border px-6 py-3">
        <h1 className="text-sm font-semibold text-foreground">{t('roadmap.settings.title')}</h1>
      </div>

      <div className="mx-auto w-full max-w-2xl px-6 py-8 flex flex-col gap-8">
        {/* Settings form */}
        <section>
          <h2 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {t('roadmap.settings.sectionHeading')}
          </h2>
          <div className="rounded-lg border border-border bg-card p-5">
            {loading ? (
              <div className="flex flex-col gap-4 animate-pulse">
                <div className="h-4 w-48 rounded bg-muted" />
                <div className="h-4 w-64 rounded bg-muted" />
              </div>
            ) : (
              <form className="flex flex-col gap-5" onSubmit={handleSave}>
                {/* Enabled toggle */}
                <SettingToggleRow
                  checked={enabled}
                  description={t('roadmap.settings.publicRoadmapDescription')}
                  label={t('roadmap.settings.publicRoadmap')}
                  onCheckedChange={setEnabled}
                />

                {/* Title */}
                <div className="flex flex-col gap-1">
                  <label
                    className="text-xs font-medium text-muted-foreground"
                    htmlFor="roadmap-title"
                  >
                    {t('roadmap.settings.titleLabel')}
                  </label>
                  <input
                    className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
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
                  <textarea
                    className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30 resize-none"
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
                    <input
                      className="flex-1 rounded-lg border border-border bg-card px-3 py-2 text-sm font-mono text-foreground placeholder:text-muted-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
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
                        className="text-xs text-red-500 hover:text-red-600 dark:text-red-400"
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
                        <p className="text-xs text-amber-600 dark:text-amber-400">
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
                          <input
                            className="rounded-lg border border-border bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30"
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
                  <button
                    className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2 disabled:opacity-50 dark:focus:ring-offset-background"
                    disabled={saving}
                    type="submit"
                  >
                    {saving ? t('common.saving') : t('roadmap.settings.saveSettings')}
                  </button>
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
                      <span
                        className="h-3 w-3 shrink-0 rounded-full"
                        style={{ backgroundColor: project.color }}
                      />
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-sm font-medium text-foreground">
                          {project.name}
                        </p>
                        <p className="truncate text-xs text-muted-foreground capitalize">
                          {project.statusType.replace(/([A-Z])/g, ' $1').trim()}
                        </p>
                      </div>
                      <button
                        aria-label={
                          project.roadmapVisible
                            ? t('roadmap.settings.removeFromRoadmap')
                            : t('roadmap.settings.addToRoadmap')
                        }
                        className="shrink-0 flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50"
                        disabled={isToggling}
                        onClick={() => handleToggleProject(project.id, project.roadmapVisible)}
                        title={
                          project.roadmapVisible
                            ? t('roadmap.settings.removeFromRoadmap')
                            : t('roadmap.settings.addToRoadmap')
                        }
                        type="button"
                      >
                        {project.roadmapVisible ? (
                          <>
                            <Eye className="h-3.5 w-3.5 text-brand" />
                            <span className="text-brand">{t('roadmap.settings.visible')}</span>
                          </>
                        ) : (
                          <>
                            <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
                            <span className="text-muted-foreground">
                              {t('roadmap.settings.hidden')}
                            </span>
                          </>
                        )}
                      </button>
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
