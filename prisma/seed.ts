import 'dotenv/config';
import crypto from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const DEMO_EMAIL = 'demo@example.com';
const DEMO_CODE = '123456';
const E2E_EMAIL = 'e2e@test.local';

function hashToken(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function main() {
  // ── Users ──────────────────────────────────────────────────────────────────

  const demoUser = await prisma.user.upsert({
    create: {
      avatarBgColor: '#6366f1',
      displayName: 'Demo User',
      email: DEMO_EMAIL,
      initials: 'DU',
      name: 'Demo User',
    },
    update: {},
    where: { email: DEMO_EMAIL },
  });

  const e2eUser = await prisma.user.upsert({
    create: {
      avatarBgColor: '#10b981',
      displayName: 'E2E Tester',
      email: E2E_EMAIL,
      initials: 'E2',
      name: 'E2E Tester',
    },
    update: {},
    where: { email: E2E_EMAIL },
  });

  // ── Organization ───────────────────────────────────────────────────────────

  const org = await prisma.organization.upsert({
    create: { name: 'Demo Org', urlKey: 'demo' },
    update: {},
    where: { urlKey: 'demo' },
  });

  // ── Org memberships ────────────────────────────────────────────────────────

  await prisma.organizationMember.upsert({
    create: { organizationId: org.id, role: 'owner', userId: demoUser.id },
    update: {},
    where: {
      organizationId_userId: { organizationId: org.id, userId: demoUser.id },
    },
  });

  await prisma.organizationMember.upsert({
    create: { organizationId: org.id, role: 'member', userId: e2eUser.id },
    update: {},
    where: {
      organizationId_userId: { organizationId: org.id, userId: e2eUser.id },
    },
  });

  // ── Team ───────────────────────────────────────────────────────────────────

  const team = await prisma.team.upsert({
    create: {
      displayName: 'Engineering',
      key: 'ENG',
      name: 'Engineering',
      organizationId: org.id,
    },
    update: {},
    where: { organizationId_key: { key: 'ENG', organizationId: org.id } },
  });

  await prisma.teamMembership.upsert({
    create: { isOwner: true, teamId: team.id, userId: demoUser.id },
    update: {},
    where: { teamId_userId: { teamId: team.id, userId: demoUser.id } },
  });

  await prisma.teamMembership.upsert({
    create: { isOwner: false, teamId: team.id, userId: e2eUser.id },
    update: {},
    where: { teamId_userId: { teamId: team.id, userId: e2eUser.id } },
  });

  // ── Workflow states ────────────────────────────────────────────────────────

  const stateConfigs = [
    { color: '#95a3b3', name: 'Backlog', position: 0, type: 'backlog' },
    { color: '#e2e8f0', name: 'Todo', position: 1, type: 'unstarted' },
    { color: '#f59e0b', name: 'In Progress', position: 2, type: 'started' },
    { color: '#10b981', name: 'Done', position: 3, type: 'completed' },
    { color: '#ef4444', name: 'Cancelled', position: 4, type: 'cancelled' },
  ];

  const states: Record<string, string> = {};
  for (const cfg of stateConfigs) {
    const existing = await prisma.workflowState.findFirst({
      where: { name: cfg.name, teamId: team.id },
    });

    const state = existing
      ? existing
      : await prisma.workflowState.create({
          data: {
            color: cfg.color,
            name: cfg.name,
            position: cfg.position,
            teamId: team.id,
            type: cfg.type,
          },
        });

    states[cfg.name] = state.id;
  }

  // Set Backlog as the default issue state for the team
  await prisma.team.update({
    data: { defaultIssueStateId: states.Backlog },
    where: { id: team.id },
  });

  // ── Sample issues ──────────────────────────────────────────────────────────

  const issueSeeds = [
    {
      identifier: 'ENG-1',
      number: 1,
      priority: 2,
      stateKey: 'Todo',
      title: 'Set up CI/CD pipeline',
    },
    {
      identifier: 'ENG-2',
      number: 2,
      priority: 1,
      stateKey: 'In Progress',
      title: 'Implement authentication flow',
    },
    {
      identifier: 'ENG-3',
      number: 3,
      priority: 0,
      stateKey: 'Todo',
      title: 'Write E2E tests for issue CRUD',
    },
  ];

  for (const seed of issueSeeds) {
    const existing = await prisma.issue.findFirst({
      where: { identifier: seed.identifier, teamId: team.id },
    });

    if (!existing) {
      await prisma.issue.create({
        data: {
          identifier: seed.identifier,
          number: seed.number,
          organizationId: org.id,
          priority: seed.priority,
          sortOrder: seed.number,
          stateId: states[seed.stateKey],
          teamId: team.id,
          title: seed.title,
        },
      });
    }
  }

  // Sync issueCount to the actual max issue number so new issues don't collide
  // with the seeded ones. The create mutation increments issueCount and uses
  // it as the next issue number, so it must be ≥ the max seeded number.
  const maxIssue = await prisma.issue.aggregate({
    _max: { number: true },
    where: { teamId: team.id },
  });
  await prisma.team.update({
    data: { issueCount: maxIssue._max.number ?? 0 },
    where: { id: team.id },
  });

  // ── Demo user magic-link token ─────────────────────────────────────────────

  // Revoke any existing magic link tokens so only the seeded one is active
  await prisma.authToken.updateMany({
    data: { revokedAt: new Date() },
    where: { revokedAt: null, type: 'magic_link', userId: demoUser.id },
  });

  // Long-lived token (1 year) — for local dev only
  await prisma.authToken.create({
    data: {
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      tokenHash: hashToken(DEMO_CODE),
      type: 'magic_link',
      userId: demoUser.id,
    },
  });

  console.log('Seed complete.');
  console.log(`  Email : ${DEMO_EMAIL}`);
  console.log(`  Code  : ${DEMO_CODE}`);
  console.log(`  Org   : ${org.urlKey}`);
  console.log(`  E2E   : ${E2E_EMAIL} (use TEST_AUTH_CODE bypass)`);
  console.log(
    `\nSkip the login form — go directly to:\n  http://localhost:3000/verify?email=${encodeURIComponent(DEMO_EMAIL)}&code=${DEMO_CODE}`,
  );
  console.log(
    '(Going through /login will revoke the seeded token by sending a new code.)',
  );
}

main()
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
