import { afterEach, describe, expect, it } from 'vitest';
import { AnthropicProvider, OpenAiProvider, resolveAiProvider } from './ai-provider';

const AI_ENV_KEYS = [
  'AI_PROVIDER',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_BASE_URL',
  'OPENAI_API_KEY',
  'OPENAI_MODEL',
  'OPENAI_BASE_URL',
];

afterEach(() => {
  for (const k of AI_ENV_KEYS) {
    delete process.env[k];
  }
});

describe('resolveAiProvider', () => {
  it('defaults to Anthropic', () => {
    expect(resolveAiProvider()).toBeInstanceOf(AnthropicProvider);
  });

  it('returns Anthropic for an unknown AI_PROVIDER (typo-safe fallback)', () => {
    process.env.AI_PROVIDER = 'gemini';
    expect(resolveAiProvider()).toBeInstanceOf(AnthropicProvider);
  });

  it('returns OpenAI when AI_PROVIDER=openai (case/space-insensitive)', () => {
    process.env.AI_PROVIDER = '  OpenAI ';
    expect(resolveAiProvider()).toBeInstanceOf(OpenAiProvider);
  });
});

describe('AnthropicProvider', () => {
  const p = new AnthropicProvider();

  it('is configured only when ANTHROPIC_API_KEY is set', () => {
    expect(p.isConfigured()).toBe(false);
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    expect(p.isConfigured()).toBe(true);
  });

  it('builds a Messages request with the version + x-api-key headers', () => {
    process.env.ANTHROPIC_API_KEY = 'sk-ant';
    const { url, init } = p.buildRequest('sys', 'usr', 64);
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    const headers = init.headers as Record<string, string>;
    expect(headers['anthropic-version']).toBeDefined();
    expect(headers['x-api-key']).toBe('sk-ant');
    const body = JSON.parse(init.body as string);
    expect(body.system).toBe('sys');
    expect(body.messages).toEqual([{ content: 'usr', role: 'user' }]);
  });

  it('respects ANTHROPIC_BASE_URL and ANTHROPIC_MODEL overrides', () => {
    // Base excludes the version segment; the provider appends /v1/messages.
    process.env.ANTHROPIC_BASE_URL = 'https://proxy.internal/';
    process.env.ANTHROPIC_MODEL = 'claude-opus-4-8';
    const { url, init } = p.buildRequest('s', 'u', 10);
    expect(url).toBe('https://proxy.internal/v1/messages');
    expect(JSON.parse(init.body as string).model).toBe('claude-opus-4-8');
  });

  it('parses the first text block from the content array', () => {
    expect(p.parseResponse({ content: [{ text: 'hello', type: 'text' }] })).toBe('hello');
    expect(p.parseResponse(null)).toBe('');
  });
});

describe('OpenAiProvider', () => {
  const p = new OpenAiProvider();

  it('is configured only when OPENAI_API_KEY is set', () => {
    expect(p.isConfigured()).toBe(false);
    process.env.OPENAI_API_KEY = 'sk-oai';
    expect(p.isConfigured()).toBe(true);
  });

  it('builds a Chat Completions request with a Bearer token and system message', () => {
    process.env.OPENAI_API_KEY = 'sk-oai';
    const { url, init } = p.buildRequest('sys', 'usr', 64);
    expect(url).toBe('https://api.openai.com/v1/chat/completions');
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer sk-oai');
    const body = JSON.parse(init.body as string);
    expect(body.messages).toEqual([
      { content: 'sys', role: 'system' },
      { content: 'usr', role: 'user' },
    ]);
  });

  it('respects OPENAI_BASE_URL for compatible endpoints', () => {
    process.env.OPENAI_BASE_URL = 'http://localhost:11434/v1';
    const { url } = p.buildRequest('s', 'u', 10);
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
  });

  it('parses choices[0].message.content', () => {
    expect(p.parseResponse({ choices: [{ message: { content: 'hi there' } }] })).toBe('hi there');
    expect(p.parseResponse({})).toBe('');
  });
});
