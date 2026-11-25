import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// An in-memory stand-in for the three tables the avatar path touches, so the
// test drives the REAL upload route, the REAL serve route and the REAL
// FileService against each other: upload as one user, then GET as others.
const files: Array<Record<string, unknown>> = [];
const members: Array<{ organizationId: string; userId: string }> = [];
const auth = { ctx: { orgId: 'org-a', userId: 'user-a' } as Record<string, unknown> };

vi.hoisted(() => {
  process.env.UPLOAD_DIR = `${require('node:os').tmpdir()}/bilinear-avatar-test-${process.pid}`;
});
vi.mock('@/server/lib/env', () => ({ env: { APP_URL: 'http://localhost:3000' } }));
vi.mock('@/server/lib/prisma', () => ({
  prisma: {
    file: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `f${files.length}`, ...data };
        files.push(row);
        return row;
      },
      findFirst: async ({ where }: { where: { key?: string } }) =>
        files.find(f => f.key === where.key) ?? null,
    },
    issue: { findFirst: async () => null, findUnique: async () => null },
    organizationMember: {
      findFirst: async ({ where }: { where: { organizationId: string; userId: string } }) =>
        members.find(m => m.organizationId === where.organizationId && m.userId === where.userId) ??
        null,
    },
    project: { findFirst: async () => null, findUnique: async () => null },
  },
}));
vi.mock('@/server/middleware/auth', () => ({
  requireAuthContext: async () => ({ ctx: auth.ctx }),
}));
vi.mock('@/server/middleware/rate-limit', () => ({
  checkFixedWindow: async () => ({ count: 1, exceeded: false }),
}));
vi.mock('@/server/services/auth.service', () => ({ apiScopesAllowWrite: () => true }));

import { GET } from '../uploads/[...path]/route';
import { POST } from './route';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function uploadReq(file: File, extra: Record<string, string> = { purpose: 'avatar' }) {
  const form = new FormData();
  form.append('file', file);
  for (const [k, v] of Object.entries(extra)) {
    form.append(k, v);
  }
  return new NextRequest('http://localhost:3000/api/upload', { body: form, method: 'POST' });
}

async function get(url: string) {
  const key = new URL(url).pathname.split('/').pop() as string;
  return GET(new NextRequest(url), { params: Promise.resolve({ path: [key] }) });
}

describe('avatar upload round trip', () => {
  beforeEach(() => {
    files.length = 0;
    members.length = 0;
    members.push(
      { organizationId: 'org-a', userId: 'user-a' },
      { organizationId: 'org-a', userId: 'user-b' },
      { organizationId: 'org-c', userId: 'user-c' },
    );
    auth.ctx = { orgId: 'org-a', userId: 'user-a' };
  });

  async function uploadAvatar() {
    const res = await POST(uploadReq(new File([PNG], 'me.png', { type: 'image/png' })));
    expect(res.status).toBe(200);
    return (await res.json()) as { url: string };
  }

  it('serves the avatar to the uploader', async () => {
    const { url } = await uploadAvatar();
    expect(url).toMatch(/\/api\/uploads\/avatar-[0-9a-f-]{36}\.png$/);
    const res = await get(url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
  });

  it('serves the avatar to a co-member of the uploader org', async () => {
    const { url } = await uploadAvatar();
    auth.ctx = { orgId: 'org-a', userId: 'user-b' };
    expect((await get(url)).status).toBe(200);
  });

  it('404s for a user whose org does not contain the uploader', async () => {
    const { url } = await uploadAvatar();
    auth.ctx = { orgId: 'org-c', userId: 'user-c' };
    expect((await get(url)).status).toBe(404);
  });

  it('does not make a plain parent-less upload readable', async () => {
    const res = await POST(uploadReq(new File([PNG], 'x.png', { type: 'image/png' }), {}));
    const { url } = (await res.json()) as { url: string };
    expect((await get(url)).status).toBe(404);
  });

  it('refuses non-image and oversized avatars', async () => {
    const pdf = await POST(uploadReq(new File([PNG], 'a.pdf', { type: 'application/pdf' })));
    expect(pdf.status).toBe(400);
    const svg = await POST(uploadReq(new File([PNG], 'a.svg', { type: 'image/svg+xml' })));
    expect(svg.status).toBe(400);
    const wrongMime = await POST(uploadReq(new File([PNG], 'a.png', { type: 'text/html' })));
    expect(wrongMime.status).toBe(400);
    const big = await POST(
      uploadReq(new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'a.png', { type: 'image/png' })),
    );
    expect(big.status).toBe(413);
    expect(files).toHaveLength(0);
  });

  it('ignores issue/project ids on an avatar upload', async () => {
    const res = await POST(
      uploadReq(new File([PNG], 'me.png', { type: 'image/png' }), {
        issueId: 'some-issue',
        purpose: 'avatar',
      }),
    );
    expect(res.status).toBe(200);
    expect(files[0].issueId).toBeNull();
  });
});
