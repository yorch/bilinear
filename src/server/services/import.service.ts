import type { Issue, PrismaClient } from '../../generated/prisma';
import { childLogger } from '../lib/logger';
import type { IssueService } from './issue.service';

const log = childLogger({ module: 'import' });

// Hard cap so a single synchronous import can't tie up the request path or
// blow memory. Larger migrations should be chunked by the client.
export const MAX_IMPORT_ROWS = 500;

// Hard cap on organizationExport's row count — a basic guard against an
// unbounded response (a JSON export of every issue in a very large org).
// Not real pagination; see exportData's doc comment.
export const MAX_EXPORT_ROWS = 10_000;

/**
 * Parse CSV text into headers + rows. Handles quoted fields, escaped quotes
 * (""), and commas/newlines inside quotes. Intentionally dependency-free.
 */
export function parseCsv(text: string): { headers: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let field = '';
  let row: string[] = [];
  let inQuotes = false;
  // Normalise CRLF/CR to LF so newline handling is uniform.
  const src = text.replace(/\r\n?/g, '\n');

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  // Flush the trailing field/row unless the input ended on a clean newline.
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const headers = rows.shift()?.map(h => h.trim()) ?? [];
  // Drop fully-empty rows (trailing blank lines).
  const dataRows = rows.filter(r => r.some(c => c.trim() !== ''));
  return { headers, rows: dataRows };
}

/** Column → issue field mapping. Values are CSV header names. */
export interface ImportMapping {
  /** Header holding an assignee email. */
  assignee?: string;
  description?: string;
  priority?: string;
  /** Header holding a workflow-state name. */
  state?: string;
  title: string;
}

export interface ImportPreview {
  headers: string[];
  rowCount: number;
  sampleRows: string[][];
}

export interface ImportResult {
  created: number;
  createdIssues: Issue[];
  errors: string[];
  skipped: number;
}

// Linear-style priority names → numeric priority (0 none … 4 low).
const PRIORITY_BY_NAME: Record<string, number> = {
  '': 0,
  high: 2,
  low: 4,
  medium: 3,
  none: 0,
  urgent: 1,
};

function parsePriority(raw: string | undefined): number {
  if (!raw) {
    return 0;
  }
  const trimmed = raw.trim().toLowerCase();
  if (trimmed in PRIORITY_BY_NAME) {
    return PRIORITY_BY_NAME[trimmed];
  }
  const n = Number.parseInt(trimmed, 10);
  return Number.isInteger(n) && n >= 0 && n <= 4 ? n : 0;
}

export class ImportService {
  constructor(
    private prisma: PrismaClient,
    private issueService: IssueService,
  ) {}

  /** Parse without writing — for the mapping UI. */
  preview(csv: string): ImportPreview {
    const { headers, rows } = parseCsv(csv);
    return { headers, rowCount: rows.length, sampleRows: rows.slice(0, 5) };
  }

  /**
   * Create issues from CSV. `title` is required; rows missing a title are
   * skipped. Assignee emails and state names are resolved against the org/team
   * (unknown values fall back to unassigned / the team default state).
   * Returns the created issues so the resolver can emit one SyncAction each.
   */
  async importIssues(
    orgId: string,
    userId: string,
    teamId: string,
    csv: string,
    mapping: ImportMapping,
  ): Promise<ImportResult> {
    const { headers, rows } = parseCsv(csv);
    if (rows.length > MAX_IMPORT_ROWS) {
      throw new Error(`Too many rows: ${rows.length}. Maximum is ${MAX_IMPORT_ROWS}.`);
    }
    const col = (name: string | undefined): number => (name ? headers.indexOf(name) : -1);
    const titleIdx = col(mapping.title);
    if (titleIdx === -1) {
      throw new Error(`Title column "${mapping.title}" not found in CSV headers`);
    }
    const descIdx = col(mapping.description);
    const prioIdx = col(mapping.priority);
    const assigneeIdx = col(mapping.assignee);
    const stateIdx = col(mapping.state);

    // Preload lookups once (avoid N queries inside the row loop).
    const emailToUserId = new Map<string, string>();
    if (assigneeIdx !== -1) {
      const members = await this.prisma.organizationMember.findMany({
        select: { user: { select: { email: true, id: true } } },
        where: { organizationId: orgId },
      });
      for (const m of members) {
        emailToUserId.set(m.user.email.toLowerCase(), m.user.id);
      }
    }
    const stateNameToId = new Map<string, string>();
    if (stateIdx !== -1) {
      const states = await this.prisma.workflowState.findMany({
        select: { id: true, name: true },
        where: { archivedAt: null, teamId },
      });
      for (const s of states) {
        stateNameToId.set(s.name.trim().toLowerCase(), s.id);
      }
    }

    const result: ImportResult = { created: 0, createdIssues: [], errors: [], skipped: 0 };
    for (let r = 0; r < rows.length; r++) {
      const cells = rows[r];
      const title = cells[titleIdx]?.trim();
      if (!title) {
        result.skipped++;
        continue;
      }
      const assigneeEmail = assigneeIdx !== -1 ? cells[assigneeIdx]?.trim().toLowerCase() : '';
      const stateName = stateIdx !== -1 ? cells[stateIdx]?.trim().toLowerCase() : '';
      try {
        const issue = await this.issueService.create(orgId, userId, {
          assigneeId: assigneeEmail ? emailToUserId.get(assigneeEmail) : undefined,
          description: descIdx !== -1 ? cells[descIdx]?.trim() || undefined : undefined,
          priority: prioIdx !== -1 ? parsePriority(cells[prioIdx]) : undefined,
          stateId: stateName ? stateNameToId.get(stateName) : undefined,
          teamId,
          title,
        });
        result.created++;
        result.createdIssues.push(issue);
      } catch (err) {
        log.warn({ err, row: r + 2 }, 'import row failed');
        // +2: 1 for the header row, 1 for 1-based line numbers.
        result.errors.push(`Row ${r + 2}: ${(err as Error).message}`);
        result.skipped++;
      }
    }
    return result;
  }

  /**
   * Full JSON export of a team's issues (or the whole org when teamId is
   * omitted). Returns a serialisable object; the resolver stringifies it.
   *
   * `take: MAX_EXPORT_ROWS` bounds the response size — without it, a large
   * org's export is an unbounded synchronous query + a potentially huge
   * JSON string built and returned in a single GraphQL response. This is a
   * basic guard, not real pagination: callers needing the full data set
   * for a very large org still need a paginated/streaming export, which is
   * out of scope here (noting as a residual, not implementing).
   */
  async exportData(orgId: string, teamId?: string): Promise<object> {
    const issues = await this.prisma.issue.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        assigneeId: true,
        createdAt: true,
        description: true,
        dueDate: true,
        estimate: true,
        identifier: true,
        priority: true,
        stateId: true,
        teamId: true,
        title: true,
      },
      take: MAX_EXPORT_ROWS,
      where: {
        archivedAt: null,
        organizationId: orgId,
        trashed: false,
        ...(teamId ? { teamId } : {}),
      },
    });
    return {
      exportedAt: new Date().toISOString(),
      issueCount: issues.length,
      issues,
      truncated: issues.length === MAX_EXPORT_ROWS,
    };
  }
}
