import { randomUUID } from 'node:crypto';
import { createWriteStream, mkdirSync, unlink } from 'node:fs';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { env } from '@/server/lib/env';
import { prisma } from '@/server/lib/prisma';
import { getUploadDir } from '@/server/lib/upload-dir';
import { requireAuthContext } from '@/server/middleware/auth';
import { apiScopesAllowWrite } from '@/server/services/auth.service';
import { FileService } from '@/server/services/file.service';

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB

// Allow-list of file extensions we accept. Mirrors the SAFE_MIME map in
// /api/uploads/[...path]/route.ts so we never persist a file the
// download endpoint can't serve safely. Anything outside this set is
// rejected at write time rather than stored and silently served as
// application/octet-stream forever.
const ALLOWED_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'pdf', 'svg']);

// Ensure the directory exists once at module load rather than on every request.
const uploadDir = getUploadDir();
mkdirSync(uploadDir, { recursive: true });

function getAppUrl(): string {
  return env.APP_URL.replace(/\/$/, '');
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
  // Routed through requireAuthContext (not a raw verifyAccessToken call) so
  // a deactivated user or a suspended/archived org can't keep uploading
  // files off a still-valid JWT — see sync/bootstrap/route.ts for the same
  // reasoning. Also picks up API-key (`bil_...`) auth for free.
  const authResult = await requireAuthContext(req, prisma);
  if ('response' in authResult) {
    return authResult.response;
  }
  const authCtx = authResult.ctx;
  // Mirror /api/graphql's mutation gate: a request authenticated via API key
  // (bil_...) rather than a user session carries `apiKeyScopes`, and uploading
  // a file is a write — a read-only key must not be able to do it. Session/JWT
  // auth leaves apiKeyScopes null, so ordinary logged-in users are unaffected.
  if (authCtx.apiKeyScopes != null && !apiScopesAllowWrite(authCtx.apiKeyScopes)) {
    return NextResponse.json({ error: 'API key lacks the "write" scope' }, { status: 403 });
  }
  const { userId, orgId } = authCtx;

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

  // Reject path-traversal-y names and disallowed extensions BEFORE writing
  // anything to disk. Filename is user-supplied — strip directory separators
  // and pull only the lowercased final extension.
  if (file.name.includes('/') || file.name.includes('\\') || file.name.includes('\x00')) {
    return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
  }
  const rawExt = file.name.includes('.') ? (file.name.split('.').pop()?.toLowerCase() ?? '') : '';
  if (!ALLOWED_EXT.has(rawExt)) {
    return NextResponse.json(
      { error: `File type not allowed (.${rawExt || 'no extension'})` },
      { status: 400 },
    );
  }

  const id = randomUUID();
  const key = `${id}.${rawExt}`;
  const filePath = join(uploadDir, key);

  try {
    // Cap the *actual* number of bytes written. `file.size` is client-
    // declared via the multipart envelope; a lying client could stream
    // gigabytes past it. The Transform aborts the pipeline as soon as
    // the cumulative byte count exceeds MAX_FILE_SIZE.
    let bytesSeen = 0;
    const sizeGuard = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        bytesSeen += chunk.length;
        if (bytesSeen > MAX_FILE_SIZE) {
          cb(new Error('file_too_large'));
          return;
        }
        cb(null, chunk);
      },
    });
    const readable = Readable.fromWeb(file.stream() as Parameters<typeof Readable.fromWeb>[0]);
    const writable = createWriteStream(filePath);
    await pipeline(readable, sizeGuard, writable);
  } catch (err) {
    // Clean up the partial file before responding so the directory
    // doesn't accumulate orphans on abuse.
    unlink(filePath, () => {});
    if ((err as Error).message === 'file_too_large') {
      return NextResponse.json(
        { error: `File exceeds ${MAX_FILE_SIZE / 1024 / 1024} MB limit` },
        { status: 413 },
      );
    }
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
