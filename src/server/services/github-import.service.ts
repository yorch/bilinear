import type {
  Comment,
  CustomFieldDefinition,
  CustomFieldValue,
  Issue,
  IssueLabel,
  PrismaClient,
} from '../../generated/prisma';
import type { ConfigReader } from '../config/reader';
import {
  createGithubIssuesClient,
  type GithubIssue,
  type GithubIssuesClient,
  parseRepoSlug,
} from '../lib/github-issues-client';
import { MAX_RICH_TEXT_LENGTH } from '../lib/limits';
import { childLogger } from '../lib/logger';
import type { CommentService } from './comment.service';
import type { CustomFieldService } from './custom-field.service';
import type { IssueService } from './issue.service';
import type { LabelService } from './label.service';

const log = childLogger({ module: 'github-import' });

const MAX_IMPORT_ROWS_KEY = 'limits.maxImportRows';

/**
 * Name of the URL custom field that records which GitHub issue a Bilinear issue
 * came from. It is the idempotency key: re-importing the same repository finds
 * the existing value and skips the issue instead of duplicating it. A custom
 * field (rather than a column) keeps the link visible to users and needs no
 * schema change.
 */
export const GITHUB_SOURCE_FIELD_NAME = 'GitHub issue';

/** One GitHub API page per call keeps a request short and gives the UI real progress. */
export const GITHUB_IMPORT_PAGE_SIZE = 30;

const FALLBACK_LABEL_COLOR = '#6b7280';
const MAX_TITLE = 512;

export interface GithubImportInput {
  includeClosed?: boolean | null;
  includeComments?: boolean | null;
  /** 1-based GitHub page. */
  page?: number | null;
  repo: string;
  /**
   * Personal access token used for this call only. Never stored or logged;
   * when absent the org's connected GitHub integration token is used, and when
   * there is none the request is anonymous (public repositories only).
   */
  token?: string | null;
}

export type GithubTokenSource = 'integration' | 'none' | 'personal';

export interface GithubImportPreview {
  repo: string;
  tokenSource: GithubTokenSource;
  /** Issues (excluding pull requests) GitHub reports, or null when unavailable. */
  totalIssues: number | null;
}

/** Everything one chunk created, so the resolver can emit a SyncAction for each. */
export interface GithubImportChunk {
  createdComments: Comment[];
  createdFieldDefinition: CustomFieldDefinition | null;
  createdIssues: Array<Issue & { labelAssignments: Array<{ labelId: string }> }>;
  createdLabels: IssueLabel[];
  errors: string[];
  /** Issues already imported earlier, skipped. */
  existing: number;
  fieldValues: CustomFieldValue[];
  /** Next GitHub page to request, or null when the repository is exhausted. */
  nextPage: number | null;
  /** Issues GitHub returned in this chunk (excluding pull requests). */
  processed: number;
  tokenSource: GithubTokenSource;
}

export class GithubImportTooLargeError extends Error {
  constructor(max: number) {
    super(
      `This import exceeds the maximum of ${max} issues. Raise limits.maxImportRows or import in parts.`,
    );
    this.name = 'GithubImportTooLargeError';
  }
}

export class GithubImportFieldUnavailableError extends Error {
  constructor() {
    super(
      `Could not create the "${GITHUB_SOURCE_FIELD_NAME}" custom field this team needs to track imported issues (field limit reached?).`,
    );
    this.name = 'GithubImportFieldUnavailableError';
  }
}

interface Deps {
  comment: Pick<CommentService, 'create'>;
  customField: Pick<CustomFieldService, 'createDefinition'>;
  issue: Pick<IssueService, 'create'>;
  label: Pick<LabelService, 'create' | 'findByOrgId'>;
}

function labelName(l: GithubIssue['labels'][number]): string {
  return typeof l === 'string' ? l : l.name;
}

function labelColor(l: GithubIssue['labels'][number]): string {
  const raw = typeof l === 'string' ? '' : (l.color ?? '');
  return /^[0-9a-fA-F]{6}$/.test(raw) ? `#${raw.toLowerCase()}` : FALLBACK_LABEL_COLOR;
}

/** GitHub's markdown is stored as-is; a footer keeps provenance without a schema change. */
export function buildDescription(issue: GithubIssue): string {
  const author = issue.user?.login ? ` by @${issue.user.login}` : '';
  const footer = `\n\n---\nImported from GitHub: ${issue.html_url}\nOpened${author} on ${issue.created_at.slice(0, 10)}.`;
  const body = (issue.body ?? '').slice(0, MAX_RICH_TEXT_LENGTH - footer.length - 1);
  return `${body}${footer}`.trim();
}

export function buildCommentBody(c: {
  body: string;
  created_at: string;
  user: { login: string } | null;
}): string {
  const who = c.user?.login ? `@${c.user.login}` : 'Someone';
  return `**${who}** commented on ${c.created_at.slice(0, 10)}:\n\n${c.body}`.slice(0, 50_000);
}

export class GithubImportService {
  constructor(
    private prisma: PrismaClient,
    private deps: Deps,
    private config?: Pick<ConfigReader, 'getInt'>,
    private client: GithubIssuesClient = createGithubIssuesClient(),
  ) {}

  private async resolveToken(
    orgId: string,
    personal: string | null | undefined,
  ): Promise<{ source: GithubTokenSource; token: string | undefined }> {
    const pat = personal?.trim();
    if (pat) {
      return { source: 'personal', token: pat };
    }
    const integration = await this.prisma.gitHubIntegration.findUnique({
      select: { accessToken: true },
      where: { organizationId: orgId },
    });
    if (integration?.accessToken) {
      return { source: 'integration', token: integration.accessToken };
    }
    return { source: 'none', token: undefined };
  }

  async preview(orgId: string, input: GithubImportInput): Promise<GithubImportPreview> {
    const repo = parseRepoSlug(input.repo);
    const { source, token } = await this.resolveToken(orgId, input.token);
    const totalIssues = await this.client.countIssues(repo, token);
    return { repo, tokenSource: source, totalIssues };
  }

  /**
   * Import one GitHub page of issues into `teamId`. Safe to repeat: issues whose
   * GitHub URL is already recorded in the source field are skipped, so an
   * interrupted import is resumed by simply starting again.
   */
  async importPage(
    orgId: string,
    userId: string,
    teamId: string,
    input: GithubImportInput,
  ): Promise<GithubImportChunk> {
    const repo = parseRepoSlug(input.repo);
    const page = Math.max(1, Math.floor(input.page ?? 1));
    const maxRows = this.config ? await this.config.getInt(MAX_IMPORT_ROWS_KEY, { orgId }) : null;
    if (maxRows !== null && (page - 1) * GITHUB_IMPORT_PAGE_SIZE >= maxRows) {
      throw new GithubImportTooLargeError(maxRows);
    }

    const { source, token } = await this.resolveToken(orgId, input.token);
    const fetched = await this.client.listIssues(repo, token, {
      includeClosed: input.includeClosed ?? true,
      page,
      perPage: GITHUB_IMPORT_PAGE_SIZE,
    });

    const chunk: GithubImportChunk = {
      createdComments: [],
      createdFieldDefinition: null,
      createdIssues: [],
      createdLabels: [],
      errors: [],
      existing: 0,
      fieldValues: [],
      nextPage: fetched.hasNext ? page + 1 : null,
      processed: fetched.items.length,
      tokenSource: source,
    };
    if (fetched.items.length === 0) {
      return chunk;
    }

    // ── source field (idempotency key) ──
    let field = await this.prisma.customFieldDefinition.findFirst({
      where: {
        archivedAt: null,
        name: GITHUB_SOURCE_FIELD_NAME,
        OR: [{ teamId }, { teamId: null }],
        organizationId: orgId,
        type: 'url',
      },
    });
    if (!field) {
      try {
        field = await this.deps.customField.createDefinition({
          description:
            'Set by the GitHub importer; used to skip issues that were already imported.',
          name: GITHUB_SOURCE_FIELD_NAME,
          organizationId: orgId,
          teamId,
          type: 'url',
        });
        chunk.createdFieldDefinition = field;
      } catch (err) {
        log.warn({ err }, 'github import: could not create source field');
        throw new GithubImportFieldUnavailableError();
      }
    }
    const definitionId = field.id;

    const urls = fetched.items.map(i => i.html_url);
    const already = await this.prisma.customFieldValue.findMany({
      select: { value: true },
      where: { definitionId, OR: urls.map(u => ({ value: { equals: u } })) },
    });
    const alreadyUrls = new Set(already.map(v => String(v.value)));

    // ── lookups, loaded once per chunk ──
    const labelsByName = new Map<string, IssueLabel>();
    for (const l of await this.deps.label.findByOrgId(orgId, teamId)) {
      labelsByName.set(l.name.trim().toLowerCase(), l);
    }

    const states = await this.prisma.workflowState.findMany({
      orderBy: { position: 'asc' },
      select: { id: true, type: true },
      where: { archivedAt: null, teamId },
    });
    const firstOfType = (type: string) => states.find(s => s.type === type)?.id;
    const completedStateId = firstOfType('completed');
    const canceledStateId = firstOfType('canceled') ?? completedStateId;

    const needsAssignee = fetched.items.some(
      i => i.assignee?.login && !alreadyUrls.has(i.html_url),
    );
    const emailToUserId = new Map<string, string>();
    if (needsAssignee) {
      const members = await this.prisma.organizationMember.findMany({
        select: { user: { select: { email: true, id: true } } },
        where: { organizationId: orgId },
      });
      for (const m of members) {
        emailToUserId.set(m.user.email.toLowerCase(), m.user.id);
      }
    }
    const loginToUserId = new Map<string, string | null>();
    const resolveAssignee = async (login: string): Promise<string | undefined> => {
      if (!loginToUserId.has(login)) {
        const email = await this.client.getUserEmail(login, token);
        loginToUserId.set(login, email ? (emailToUserId.get(email.toLowerCase()) ?? null) : null);
      }
      return loginToUserId.get(login) ?? undefined;
    };

    for (const gh of fetched.items) {
      if (alreadyUrls.has(gh.html_url)) {
        chunk.existing++;
        continue;
      }
      try {
        // Labels: reuse by name, create missing ones team-scoped.
        const labelIds: string[] = [];
        for (const gl of gh.labels) {
          const name = labelName(gl).trim();
          if (!name) {
            continue;
          }
          let label = labelsByName.get(name.toLowerCase());
          if (!label) {
            label = await this.deps.label.create(orgId, userId, {
              color: labelColor(gl),
              name: name.slice(0, 255),
              teamId,
            });
            labelsByName.set(name.toLowerCase(), label);
            chunk.createdLabels.push(label);
          }
          labelIds.push(label.id);
        }

        const assigneeLogin = gh.assignee?.login ?? gh.assignees?.[0]?.login;
        const assigneeId = assigneeLogin ? await resolveAssignee(assigneeLogin) : undefined;

        const stateId =
          gh.state === 'closed'
            ? gh.state_reason === 'not_planned'
              ? canceledStateId
              : completedStateId
            : undefined;

        // The source-URL marker is written in the same transaction as the
        // issue: a crash between the two would otherwise leave an unmarked
        // issue that the next run imports a second time.
        let value: CustomFieldValue | undefined;
        const issue = await this.deps.issue.create(
          orgId,
          userId,
          {
            assigneeId,
            description: buildDescription(gh),
            labelIds,
            stateId,
            teamId,
            title: gh.title.trim().slice(0, MAX_TITLE) || `GitHub issue #${gh.number}`,
          },
          async (tx, created) => {
            value = await (tx as unknown as PrismaClient).customFieldValue.create({
              data: { definitionId, issueId: created.id, value: gh.html_url },
            });
          },
        );
        if (value) {
          chunk.fieldValues.push(value);
        }

        const labelAssignments = labelIds.length
          ? await this.prisma.issueLabelAssignment.findMany({
              select: { labelId: true },
              where: { issueId: issue.id },
            })
          : [];
        chunk.createdIssues.push({ ...issue, labelAssignments });

        if ((input.includeComments ?? false) && gh.comments > 0) {
          try {
            for (const c of await this.client.listComments(repo, gh.number, token)) {
              if (!c.body?.trim()) {
                continue;
              }
              const created = await this.deps.comment.create(userId, {
                body: buildCommentBody(c),
                issueId: issue.id,
              });
              chunk.createdComments.push(created as unknown as Comment);
            }
          } catch (err) {
            // The issue itself is in; a comment failure is reported, not fatal.
            chunk.errors.push(`#${gh.number}: comments not imported (${(err as Error).message})`);
          }
        }
      } catch (err) {
        log.warn({ err, number: gh.number }, 'github import: issue failed');
        chunk.errors.push(`#${gh.number}: ${(err as Error).message}`);
      }
    }
    return chunk;
  }
}
