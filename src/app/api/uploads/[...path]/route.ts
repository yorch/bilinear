import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Readable } from 'node:stream';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { verifyAccessToken } from '@/server/lib/jwt';
import { getUploadDir } from '@/server/lib/upload-dir';

/**
 * GET /api/uploads/[...path]
 *
 * Serves files uploaded via /api/upload. Requires authentication and restricts
 * access to the configured upload directory (no path traversal).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const token =
    req.cookies.get('access_token')?.value ??
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    null;

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await verifyAccessToken(token);
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { path } = await params;

  // Sanitise: only allow the filename component, no directory traversal.
  const filename = basename(path.join('/'));
  const uploadDir = getUploadDir();
  const filePath = join(uploadDir, filename);

  // Ensure the resolved path is still inside the upload directory.
  if (!filePath.startsWith(`${uploadDir}/`) && filePath !== uploadDir) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let size: number;
  try {
    ({ size } = await stat(filePath));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    throw err;
  }

  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  const mimeMap: Record<string, string> = {
    gif: 'image/gif',
    jpeg: 'image/jpeg',
    jpg: 'image/jpeg',
    pdf: 'application/pdf',
    png: 'image/png',
    svg: 'image/svg+xml',
    webp: 'image/webp',
  };
  const contentType = mimeMap[ext] ?? 'application/octet-stream';

  const stream = createReadStream(filePath);
  const webStream = Readable.toWeb(stream) as ReadableStream;

  return new NextResponse(webStream, {
    headers: {
      'Cache-Control': 'private, max-age=3600',
      'Content-Length': String(size),
      'Content-Type': contentType,
    },
    status: 200,
  });
}
