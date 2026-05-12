import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Readable } from 'node:stream';
import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { verifyAccessToken } from '@/server/lib/jwt';
import { prisma } from '@/server/lib/prisma';
import { getUploadDir } from '@/server/lib/upload-dir';
import { FileService } from '@/server/services/file.service';

// MIME types that can be rendered as executable content (SVG scripts, HTML,
// XML-with-script) — force browser download instead of inline rendering to
// prevent stored XSS via user-uploaded files.
const UNSAFE_INLINE_MIME = new Set([
  'image/svg+xml',
  'text/html',
  'application/xhtml+xml',
  'application/xml',
  'text/xml',
]);

/**
 * Build a safe RFC 5987 / 6266 `Content-Disposition` header value. The
 * stored filename is user-supplied (passed straight through from the
 * upload's multipart name) and historically only had `"` stripped — a
 * control character like CR/LF in the name could inject HTTP headers via
 * the response writer. Strip all C0 controls, quotes, and backslashes
 * for the ASCII fallback, and use `filename*=UTF-8''…` for non-ASCII so
 * downloads still preserve the original name where the browser supports it.
 */
function buildContentDisposition(rawName: string): string {
  // Strip C0 controls + DEL char-by-char (CR/LF are the actual injection
  // vectors). Avoids embedding the control range in a regex literal, which
  // the linter (correctly) flags as a smell — even though stripping is the
  // intent here.
  let sanitized = '';
  for (const ch of rawName) {
    const code = ch.charCodeAt(0);
    if (code < 0x20 || code === 0x7f || ch === '"' || ch === '\\') {
      continue;
    }
    sanitized += ch;
  }
  // ASCII fallback: anything outside printable ASCII becomes `_`.
  let ascii = '';
  for (const ch of sanitized) {
    const code = ch.charCodeAt(0);
    ascii += code >= 0x20 && code <= 0x7e ? ch : '_';
  }
  ascii = ascii.slice(0, 200) || 'download';
  const encoded = encodeURIComponent(sanitized);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

const SAFE_MIME: Record<string, string> = {
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  pdf: 'application/pdf',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
};

/**
 * GET /api/uploads/[...path]
 *
 * Serves files uploaded via /api/upload. Requires authentication AND that the
 * caller belongs to the org that owns the file (via attached issue/project),
 * so a leaked URL cannot be used to download another org's attachments.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const token =
    req.cookies.get('access_token')?.value ??
    req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ??
    null;

  if (!token) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let orgId: string;
  try {
    ({ orgId } = await verifyAccessToken(token));
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

  // Verify the file record exists and belongs to the caller's org.
  const fileService = new FileService(prisma);
  const record = await fileService.findByKeyInOrg(filename, orgId);
  if (!record) {
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
  const contentType = SAFE_MIME[ext] ?? 'application/octet-stream';
  const forceDownload = UNSAFE_INLINE_MIME.has(contentType);

  const headers: Record<string, string> = {
    'Cache-Control': 'private, max-age=3600',
    'Content-Length': String(size),
    'Content-Type': contentType,
    // Block MIME-sniffing so "image/png" can't be reinterpreted as HTML.
    'X-Content-Type-Options': 'nosniff',
  };
  if (forceDownload) {
    headers['Content-Disposition'] = buildContentDisposition(record.name);
  }

  const stream = createReadStream(filePath);
  const webStream = Readable.toWeb(stream) as ReadableStream;

  return new NextResponse(webStream, {
    headers,
    status: 200,
  });
}
