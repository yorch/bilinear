import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Drives the REAL upload route and REAL FileService/getSyncVisibility against
// an in-memory prisma, so the issue-attachment gate is tested end to end:
// private-team denial and the guest narrowing, not just the service method.
const db = vi.hoisted(() => ({
  files: [] as Array<Record<string, unknown>>,
  guestRoles: [] as Array<{ team: { organizationId: string }; teamId: string; userId: string }>,
  issue: null as null | { assigneeId: string | null; creatorId: string | null; teamId: string },
  privateTeams: [] as Array<{
    id: string;
    memberships: Array<{ userId: string }>;
    organizationId: string;
  }>,
}));

vi.hoisted(() => {
  process.env.UPLOAD_DIR = `${require('node:os').tmpdir()}/bilinear-attach-test-${process.pid}`;
});
vi.mock('@/server/lib/env', () => ({ env: { APP_URL: 'http://localhost:3000' } }));
vi.mock('@/server/lib/prisma', () => ({
  prisma: {
    file: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `f${db.files.length}`, ...data };
        db.files.push(row);
        return row;
      },
    },
    issue: { findFirst: async () => db.issue },
    project: { findUnique: async () => null },
    team: { findMany: async () => db.privateTeams },
    teamMemberRole: { findMany: async () => db.guestRoles },
  },
}));
vi.mock('@/server/middleware/auth', () => ({
  requireAuthContext: async () => ({ ctx: { orgId: 'org-a', userId: 'user-a' } }),
}));
vi.mock('@/server/middleware/rate-limit', () => ({
  checkFixedWindow: async () => ({ count: 1, exceeded: false }),
}));
vi.mock('@/server/services/auth.service', () => ({ apiScopesAllowWrite: () => true }));

import { POST } from './route';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function upload() {
  const form = new FormData();
  form.append('file', new File([PNG], 'a.png', { type: 'image/png' }));
  form.append('issueId', 'issue-1');
  return POST(new NextRequest('http://localhost:3000/api/upload', { body: form, method: 'POST' }));
}

describe('POST /api/upload issue attachment visibility', () => {
  beforeEach(() => {
    db.files.length = 0;
    db.privateTeams = [];
    db.guestRoles = [];
    db.issue = { assigneeId: 'someone', creatorId: 'someone', teamId: 'team-1' };
  });

  it('allows a member on a visible issue', async () => {
    expect((await upload()).status).toBe(200);
    expect(db.files).toHaveLength(1);
  });

  it('denies a non-member of the issue private team and stores nothing', async () => {
    db.privateTeams = [{ id: 'team-1', memberships: [], organizationId: 'org-a' }];
    expect((await upload()).status).toBe(403);
    expect(db.files).toHaveLength(0);
  });

  it('allows a member of the private team', async () => {
    db.privateTeams = [
      { id: 'team-1', memberships: [{ userId: 'user-a' }], organizationId: 'org-a' },
    ];
    expect((await upload()).status).toBe(200);
  });

  it('denies a guest on an issue that is not theirs', async () => {
    db.guestRoles = [{ team: { organizationId: 'org-a' }, teamId: 'team-1', userId: 'user-a' }];
    expect((await upload()).status).toBe(403);
    expect(db.files).toHaveLength(0);
  });

  it('allows a guest on an issue they created', async () => {
    db.guestRoles = [{ team: { organizationId: 'org-a' }, teamId: 'team-1', userId: 'user-a' }];
    db.issue = { assigneeId: null, creatorId: 'user-a', teamId: 'team-1' };
    expect((await upload()).status).toBe(200);
  });
});
