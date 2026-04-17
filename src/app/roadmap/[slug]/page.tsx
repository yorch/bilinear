import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { PublicRoadmapView } from '@/components/roadmap/public-roadmap-view';
import { prisma } from '@/server/lib/prisma';
import { verifyRoadmapPassword } from '@/server/services/roadmap.service';

interface Props {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ password?: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const roadmap = await prisma.publicRoadmap.findUnique({ where: { slug } });
  if (!roadmap) {
    return { title: 'Roadmap not found' };
  }
  return { title: roadmap.title };
}

export default async function PublicRoadmapPage({
  params,
  searchParams,
}: Props) {
  const { slug } = await params;
  const { password } = await searchParams;

  const roadmap = await prisma.publicRoadmap.findUnique({ where: { slug } });

  if (!roadmap?.enabled) {
    notFound();
  }

  const requiresPassword = !!roadmap.passwordHash && !password;
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
    if (roadmap.passwordHash && password) {
      const valid = await verifyRoadmapPassword(roadmap.passwordHash, password);
      if (!valid) {
        return (
          <PublicRoadmapView
            projects={[]}
            requiresPassword
            roadmap={{ ...roadmap, passwordHash: null }}
          />
        );
      }
    }

    const rawProjects = await prisma.project.findMany({
      include: { milestones: { where: { archivedAt: null } } },
      where: {
        archivedAt: null,
        organizationId: roadmap.organizationId,
        roadmapVisible: true,
        trashed: false,
      },
    });

    projects = rawProjects.map(p => ({
      color: p.color,
      health: p.health,
      icon: p.icon,
      id: p.id,
      milestoneCount: p.milestones.length,
      name: p.name,
      progress: p.progress,
      statusName: p.statusName,
      statusType: p.statusType,
      targetDate: p.targetDate,
    }));
  }

  return (
    <PublicRoadmapView
      projects={projects}
      requiresPassword={requiresPassword}
      roadmap={{ ...roadmap, passwordHash: null }}
    />
  );
}
