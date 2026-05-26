import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Lightweight liveness probe for the container HEALTHCHECK.
export function GET() {
  return NextResponse.json({ status: 'ok' });
}
