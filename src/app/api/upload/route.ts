import { randomUUID } from 'node:crypto';
import { createWriteStream, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { verifyAccessToken } from '@/server/lib/jwt';
import { prisma } from '@/server/lib/prisma';
import { getUploadDir } from '@/server/lib/upload-dir';
import { FileService } from '@/server/services/file.service';

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

// Ensure the directory exists once at module load rather than on every request.
const uploadDir = getUploadDir();
mkdirSync(uploadDir, { recursive: true });

function getAppUrl(): string {
  return (process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

/**
 * POST /api/upload
 *
 * Accepts multipart/form-data with fields:
 *   file     - the file blob (required)
 *   issueId  - UUID of the issue to attach to (optional)
 *   projectId - UUID of the project to attach to (optional)
 *
 * Returns: { id, name, url, size, mimeType }
 */
export async function POST(req: NextRequest) {
  const token =
    req.cookies.get('access_token')?.value ??
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    null;

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let userId: string;
  let orgId: string;
  try {
    ({ userId, orgId } = await verifyAccessToken(token));
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Missing file field' }, { status: 400 });
  }

  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `File exceeds ${MAX_FILE_SIZE / 1024 / 1024} MB limit` },
      { status: 413 },
    );
  }

  const issueId = formData.get('issueId');
  const projectId = formData.get('projectId');

  // Verify the caller can attach to the given issue/project (parallel lookups).
  const [issueOk, projectOk] = await Promise.all([
    typeof issueId === 'string'
      ? prisma.issue
          .findUnique({
            select: { organizationId: true },
            where: { id: issueId },
          })
          .then(r => r?.organizationId === orgId)
      : true,
    typeof projectId === 'string'
      ? prisma.project
          .findUnique({
            select: { organizationId: true },
            where: { id: projectId },
          })
          .then(r => r?.organizationId === orgId)
      : true,
  ]);

  if (!issueOk || !projectOk) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const id = randomUUID();
  const ext = file.name.includes('.') ? `.${file.name.split('.').pop()}` : '';
  const key = `${id}${ext}`;
  const filePath = join(uploadDir, key);

  try {
    const readable = Readable.fromWeb(file.stream() as Parameters<typeof Readable.fromWeb>[0]);
    const writable = createWriteStream(filePath);
    await pipeline(readable, writable);
  } catch {
    return NextResponse.json({ error: 'Failed to save file' }, { status: 500 });
  }

  const url = `${getAppUrl()}/api/uploads/${key}`;

  const fileService = new FileService(prisma);
  const record = await fileService.createFile(userId, {
    issueId: typeof issueId === 'string' ? issueId : undefined,
    key,
    mimeType: file.type || 'application/octet-stream',
    name: file.name,
    projectId: typeof projectId === 'string' ? projectId : undefined,
    size: file.size,
    url,
  });

  return NextResponse.json({
    id: record.id,
    mimeType: record.mimeType,
    name: record.name,
    size: record.size,
    url: record.url,
  });
}
