import type { Issue, PrismaClient } from '../../generated/prisma';
import { childLogger } from '../lib/logger';
import type { SearchService } from './search.service';

const log = childLogger({ module: 'ai' });

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';
// Utility tasks (titles, short summaries, ranking) are well served by a fast,
// inexpensive model. Override with ANTHROPIC_MODEL for higher quality.
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

/** Thrown when AI is not configured/enabled — resolver maps to FORBIDDEN. */
export class AiDisabledError extends Error {
  constructor() {
    super('AI features are not enabled for this workspace');
    this.name = 'AiDisabledError';
  }
}

/** Thrown when the upstream model call fails — resolver maps to BAD_USER_INPUT. */
export class AiRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AiRequestError';
  }
}

export interface DuplicateCandidate {
  id: string;
  identifier: string;
  title: string;
}

/**
 * AI assistant features backed by the Anthropic Messages API. Stateless —
 * every call reads `ANTHROPIC_API_KEY` (presence gates availability) and the
 * per-org `aiEnabled` flag. Network calls happen at request time and are
 * never persisted; resolvers expose the results as plain payloads (no
 * SyncAction, since nothing is written to the replicated dataset).
 */
export class AiService {
  constructor(
    private prisma: PrismaClient,
    private search: SearchService,
  ) {}

  private get apiKey(): string {
    return process.env.ANTHROPIC_API_KEY ?? '';
  }

  private get model(): string {
    return process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
  }

  /** Server-side: is an API key configured at all? */
  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  /** Both a server key AND the per-org toggle are required. */
  async assertEnabled(orgId: string): Promise<void> {
    if (!this.isConfigured()) {
      throw new AiDisabledError();
    }
    const org = await this.prisma.organization.findUnique({
      select: { aiEnabled: true },
      where: { id: orgId },
    });
    if (!org?.aiEnabled) {
      throw new AiDisabledError();
    }
  }

  /**
   * Single-turn completion against the Messages API. Kept private so callers
   * go through the task-specific helpers below, which own their prompts.
   */
  private async complete(system: string, user: string, maxTokens: number): Promise<string> {
    let res: Response;
    try {
      res = await fetch(ANTHROPIC_URL, {
        body: JSON.stringify({
          max_tokens: maxTokens,
          messages: [{ content: user, role: 'user' }],
          model: this.model,
          system,
        }),
        headers: {
          'anthropic-version': ANTHROPIC_VERSION,
          'content-type': 'application/json',
          'x-api-key': this.apiKey,
        },
        method: 'POST',
      });
    } catch (err) {
      log.error({ err }, 'Anthropic request failed');
      throw new AiRequestError('Failed to reach the AI provider');
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      log.error({ detail, status: res.status }, 'Anthropic API error');
      throw new AiRequestError(`AI provider returned ${res.status}`);
    }
    const data = (await res.json().catch(() => null)) as {
      content?: Array<{ text?: string; type?: string }>;
    } | null;
    const text =
      data?.content?.find(b => b.type === 'text')?.text ?? data?.content?.[0]?.text ?? '';
    return text.trim();
  }

  /** Suggest a concise issue title from a free-form description. */
  async suggestTitle(description: string): Promise<string> {
    const trimmed = description.trim();
    if (!trimmed) {
      throw new AiRequestError('Description is empty');
    }
    const system =
      'You write concise, specific issue tracker titles. Reply with ONLY the title — ' +
      'no quotes, no trailing punctuation, at most 80 characters, imperative mood.';
    const text = await this.complete(system, `Description:\n${trimmed.slice(0, 4000)}`, 64);
    // Take the first line, then strip wrapping quotes/backticks and clamp.
    return (text.split('\n')[0] ?? '')
      .trim()
      .replace(/^["'`]+|["'`]+$/g, '')
      .trim()
      .slice(0, 200);
  }

  /** Summarize an issue (title + description) into a short paragraph. */
  async summarizeIssue(orgId: string, issueId: string): Promise<string> {
    const issue = await this.prisma.issue.findFirst({
      select: { description: true, identifier: true, organizationId: true, title: true },
      where: { id: issueId, organizationId: orgId },
    });
    if (!issue) {
      throw new AiRequestError('Issue not found');
    }
    const system =
      'You summarize software issues for busy teammates. Reply with a 1-3 sentence ' +
      'plain-text summary capturing the problem and any decisions. No preamble.';
    const body = `Title: ${issue.title}\n\nDescription:\n${(issue.description ?? '').slice(0, 8000)}`;
    return this.complete(system, body, 256);
  }

  /**
   * Find likely duplicates of an issue. Retrieves candidates via full-text
   * search on the title (cheap, bounded) and asks the model to keep only the
   * genuine duplicates, returning their identifiers. Resolves identifiers back
   * to issue rows for the caller.
   */
  async findDuplicates(orgId: string, issueId: string): Promise<DuplicateCandidate[]> {
    const issue = await this.prisma.issue.findFirst({
      select: { id: true, organizationId: true, title: true },
      where: { id: issueId, organizationId: orgId },
    });
    if (!issue) {
      throw new AiRequestError('Issue not found');
    }
    const candidates = (await this.search.searchIssues(orgId, issue.title, 15))
      .filter(c => c.id !== issue.id)
      .slice(0, 12);
    if (candidates.length === 0) {
      return [];
    }
    const list = candidates.map(c => `${c.identifier}: ${c.title}`).join('\n');
    const system =
      'You detect duplicate issues. Given a target issue and candidates, reply with a ' +
      'comma-separated list of the identifiers (e.g. ENG-12) that are genuine duplicates ' +
      'of the target. Reply with "none" if there are no duplicates. Identifiers only.';
    const answer = await this.complete(
      system,
      `Target: ${issue.title}\n\nCandidates:\n${list}`,
      128,
    );
    if (/^\s*none\s*$/i.test(answer)) {
      return [];
    }
    const picked = new Set(
      answer
        .toUpperCase()
        .match(/[A-Z][A-Z0-9]{1,9}-\d+/g)
        ?.map(s => s.trim()) ?? [],
    );
    return candidates
      .filter((c): c is Issue => picked.has(c.identifier.toUpperCase()))
      .map(c => ({ id: c.id, identifier: c.identifier, title: c.title }));
  }
}
