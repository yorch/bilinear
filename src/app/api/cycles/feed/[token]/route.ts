import { NextResponse } from 'next/server';
import { prisma } from '@/server/lib/prisma';

export const runtime = 'nodejs';

// UID namespace for VEVENT identifiers — stable across rotates because
// cycle IDs are UUIDs, not the token.
const PRODID = '-//Bilinear//Cycle Feed//EN';

function icsDate(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

function escapeIcs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  const { token } = await params;
  // Strip the trailing ".ics" extension that may appear in the URL.
  const rawToken = token.replace(/\.ics$/, '');

  const user = await prisma.user.findUnique({
    select: { id: true, name: true },
    where: { calendarFeedToken: rawToken },
  });

  if (!user) {
    return new NextResponse('Not found', { status: 404 });
  }

  // Fetch every upcoming cycle for every team the user is a member of.
  const memberships = await prisma.teamMembership.findMany({
    select: { teamId: true },
    where: { userId: user.id },
  });
  const teamIds = memberships.map(m => m.teamId);

  const cycles = await prisma.cycle.findMany({
    orderBy: { startsAt: 'asc' },
    select: {
      endsAt: true,
      id: true,
      name: true,
      number: true,
      startsAt: true,
      team: { select: { name: true } },
    },
    where: {
      archivedAt: null,
      completedAt: null,
      teamId: { in: teamIds },
    },
  });

  const now = new Date();
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    `PRODID:${PRODID}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcs(user.name)} — Cycles`,
    'X-WR-TIMEZONE:UTC',
  ];

  for (const cycle of cycles) {
    const summary = cycle.name
      ? escapeIcs(`${cycle.team.name} — ${cycle.name}`)
      : escapeIcs(`${cycle.team.name} Sprint ${cycle.number}`);
    lines.push(
      'BEGIN:VEVENT',
      `UID:bilinear-cycle-${cycle.id}@bilinear`,
      `DTSTAMP:${icsDate(now)}`,
      `DTSTART;VALUE=DATE:${cycle.startsAt.toISOString().split('T')[0].replace(/-/g, '')}`,
      `DTEND;VALUE=DATE:${cycle.endsAt.toISOString().split('T')[0].replace(/-/g, '')}`,
      `SUMMARY:${summary}`,
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');

  return new NextResponse(lines.join('\r\n'), {
    headers: {
      'Content-Disposition': 'attachment; filename="cycles.ics"',
      'Content-Type': 'text/calendar; charset=utf-8',
    },
    status: 200,
  });
}
