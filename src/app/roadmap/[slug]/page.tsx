import type { Metadata } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { PublicRoadmapView } from '@/components/roadmap/public-roadmap-view';
import { getServerTranslations } from '@/lib/i18n/server';
import { prisma } from '@/server/lib/prisma';
import { ProjectService } from '@/server/services/project.service';
import {
  isRoadmapUnlockTokenValid,
  roadmapUnlockCookieName,
} from '@/server/services/roadmap.service';

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string }>;
}

const getRoadmapBySlug = cache((slug: string) =>
  prisma.publicRoadmap.findUnique({ where: { slug } }),
);

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const roadmap = await getRoadmapBySlug(slug);
  if (!roadmap) {
    const { t } = await getServerTranslations();
    return { title: t('meta.roadmapNotFound') };
  }
  return { title: roadmap.title };
}

export default async function PublicRoadmapPage({ params, searchParams }: Props) {
  const { slug } = await params;
  const { error } = await searchParams;

  const roadmap = await getRoadmapBySlug(slug);

  if (!roadmap?.enabled) {
    notFound();
  }

  // The password is entered via POST /roadmap/[slug]/unlock, which sets this
  // cookie; it is never accepted from the URL.
  const unlocked =
    !roadmap.passwordHash ||
    isRoadmapUnlockTokenValid(
      (await cookies()).get(roadmapUnlockCookieName(slug))?.value,
      slug,
      roadmap.passwordHash,
    );
  const requiresPassword = !unlocked;
  let projects: Array<{
    color: string;
    health: string | null;
    icon: string | null;
    id: string;
    milestoneCount: number;
    name: string;
    progress: number;
    statusName: string | null;
    statusType: string;
    targetDate: Date | null;
  }> = [];

  if (!requiresPassword) {
    const rawProjects = await prisma.project.findMany({
      include: { milestones: { where: { archivedAt: null } } },
      where: {
        archivedAt: null,
        organizationId: roadmap.organizationId,
        roadmapVisible: true,
        trashed: false,
      },
    });

    // Progress is computed from the issue set, never stored — `ProjectService`
    // owns the rule and answers the whole list in two queries.
    const progressById = await new ProjectService(prisma).getProgressBatch(
      rawProjects.map(p => p.id),
    );

    projects = rawProjects.map(p => ({
      color: p.color,
      health: p.health,
      icon: p.icon,
      id: p.id,
      milestoneCount: p.milestones.length,
      name: p.name,
      progress: progressById.get(p.id)?.progress ?? 0,
      statusName: p.statusName,
      statusType: p.statusType,
      targetDate: p.targetDate,
    }));
  }

  return (
    <PublicRoadmapView
      passwordError={error === 'rate' ? 'rate' : error ? 'wrong' : false}
      projects={projects}
      requiresPassword={requiresPassword}
      roadmap={{ ...roadmap, passwordHash: null }}
    />
  );
}
