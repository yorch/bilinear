import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';

function getUploadDir(): string {
  return process.env.UPLOAD_DIR
    ? resolve(process.env.UPLOAD_DIR)
    : resolve(process.cwd(), 'uploads');
}

/**
 * GET /api/uploads/[...path]
 *
 * Serves files uploaded via /api/upload. Restricts access to the configured
 * upload directory (no path traversal).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path } = await params;

  // Sanitise: only allow the filename component, no directory traversal.
  const filename = basename(path.join('/'));
  const uploadDir = getUploadDir();
  const filePath = join(uploadDir, filename);

  // Ensure the resolved path is still inside the upload directory.
  if (!filePath.startsWith(uploadDir + '/') && filePath !== uploadDir) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  if (!existsSync(filePath)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  let size: number;
  try {
    ({ size } = await stat(filePath));
  } catch {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
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
      'Cache-Control': 'public, max-age=31536000, immutable',
      'Content-Length': String(size),
      'Content-Type': contentType,
    },
    status: 200,
  });
}
