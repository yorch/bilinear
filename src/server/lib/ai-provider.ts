// Pluggable AI backends for AiService. A provider is a pure request builder +
// response parser; the HTTP call, status checks and error wrapping live in
// AiService so error types stay in one place (no circular imports). Select the
// active provider with AI_PROVIDER ('anthropic' — default — or 'openai'); each
// reads its own credentials/model/base-URL from the environment at call time,
// keeping the service stateless.

/** A single-turn chat backend. Implementations must be side-effect free. */
export interface AiProvider {
  /** Build the HTTP request for a single system+user completion. */
  buildRequest(system: string, user: string, maxTokens: number): { init: RequestInit; url: string };
  /** Whether the credentials this provider needs are present in the env. */
  isConfigured(): boolean;
  /** Stable id for logging/diagnostics, e.g. 'anthropic' | 'openai'. */
  readonly name: string;
  /** Extract the assistant text from the parsed JSON body ('' if absent). */
  parseResponse(data: unknown): string;
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/$/, '');
}

/** Anthropic Messages API (https://docs.anthropic.com/en/api/messages). */
export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';

  constructor(private readonly modelOverride?: string) {}

  // Utility tasks (titles, short summaries, ranking) are well served by a
  // fast, inexpensive model. Override with ANTHROPIC_MODEL for higher quality.
  private static readonly DEFAULT_MODEL = 'claude-haiku-4-5-20251001';
  // Base URL excludes the version segment (SDK convention) — the `/v1/messages`
  // path is appended below.
  private static readonly DEFAULT_BASE_URL = 'https://api.anthropic.com';
  private static readonly API_VERSION = '2023-06-01';

  isConfigured(): boolean {
    return (process.env.ANTHROPIC_API_KEY ?? '').length > 0;
  }

  buildRequest(
    system: string,
    user: string,
    maxTokens: number,
  ): { init: RequestInit; url: string } {
    const baseUrl = trimTrailingSlash(
      process.env.ANTHROPIC_BASE_URL || AnthropicProvider.DEFAULT_BASE_URL,
    );
    return {
      init: {
        body: JSON.stringify({
          max_tokens: maxTokens,
          messages: [{ content: user, role: 'user' }],
          model:
            this.modelOverride || process.env.ANTHROPIC_MODEL || AnthropicProvider.DEFAULT_MODEL,
          system,
        }),
        headers: {
          'anthropic-version': AnthropicProvider.API_VERSION,
          'content-type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
        },
        method: 'POST',
      },
      url: `${baseUrl}/v1/messages`,
    };
  }

  parseResponse(data: unknown): string {
    const body = data as { content?: Array<{ text?: string; type?: string }> } | null;
    return body?.content?.find(b => b.type === 'text')?.text ?? body?.content?.[0]?.text ?? '';
  }
}

/**
 * OpenAI-compatible Chat Completions API. Works with OpenAI itself and any
 * service that speaks the same protocol (Azure OpenAI, OpenRouter, Together,
 * local servers like Ollama/LM Studio) by pointing OPENAI_BASE_URL at them.
 */
export class OpenAiProvider implements AiProvider {
  constructor(private readonly modelOverride?: string) {}

  readonly name = 'openai';

  private static readonly DEFAULT_MODEL = 'gpt-4o-mini';
  private static readonly DEFAULT_BASE_URL = 'https://api.openai.com/v1';

  isConfigured(): boolean {
    return (process.env.OPENAI_API_KEY ?? '').length > 0;
  }

  buildRequest(
    system: string,
    user: string,
    maxTokens: number,
  ): { init: RequestInit; url: string } {
    const baseUrl = trimTrailingSlash(
      process.env.OPENAI_BASE_URL || OpenAiProvider.DEFAULT_BASE_URL,
    );
    return {
      init: {
        body: JSON.stringify({
          max_tokens: maxTokens,
          messages: [
            { content: system, role: 'system' },
            { content: user, role: 'user' },
          ],
          model: this.modelOverride || process.env.OPENAI_MODEL || OpenAiProvider.DEFAULT_MODEL,
        }),
        headers: {
          authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ''}`,
          'content-type': 'application/json',
        },
        method: 'POST',
      },
      url: `${baseUrl}/chat/completions`,
    };
  }

  parseResponse(data: unknown): string {
    const body = data as { choices?: Array<{ message?: { content?: string } }> } | null;
    return body?.choices?.[0]?.message?.content ?? '';
  }
}

/** Runtime overrides resolved from the config registry, when available. */
export interface AiProviderOverrides {
  anthropicModel?: string;
  openaiModel?: string;
  provider?: string;
}

/**
 * Resolve the active provider.
 *
 * Takes overrides resolved from the config registry so the provider and model
 * can be changed without a redeploy; falls back to AI_PROVIDER and then to
 * Anthropic. Unknown values fall back to Anthropic so a typo never silently
 * disables AI. An empty model override is ignored rather than sent as an empty
 * model name — the registry's default for those keys is '' meaning "unset".
 */
export function resolveAiProvider(overrides: AiProviderOverrides = {}): AiProvider {
  const choice = (overrides.provider || process.env.AI_PROVIDER || 'anthropic')
    .trim()
    .toLowerCase();
  if (choice === 'openai') {
    return new OpenAiProvider(overrides.openaiModel || undefined);
  }
  return new AnthropicProvider(overrides.anthropicModel || undefined);
}
