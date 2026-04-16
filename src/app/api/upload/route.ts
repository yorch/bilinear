import { randomUUID } from 'node:crypto';
import { createWriteStream, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { verifyAccessToken } from '@/server/lib/jwt';
import { prisma } from '@/server/lib/prisma';
import { FileService } from '@/server/services/file.service';

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

function getUploadDir(): string {
  const dir = process.env.UPLOAD_DIR
    ? resolve(process.env.UPLOAD_DIR)
    : resolve(process.cwd(), 'uploads');
  mkdirSync(dir, { recursive: true });
  return dir;
}

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
  try {
    ({ userId } = await verifyAccessToken(token));
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

  const id = randomUUID();
  const ext = file.name.includes('.') ? `.${file.name.split('.').pop()}` : '';
  const key = `${id}${ext}`;

  const uploadDir = getUploadDir();
  const filePath = join(uploadDir, key);

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const readable = Readable.from(buffer);
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
