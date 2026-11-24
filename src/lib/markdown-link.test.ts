import { describe, expect, it } from 'vitest';
import { toMarkdownLink } from './markdown-link';

describe('toMarkdownLink', () => {
  it('leaves plain text alone', () => {
    expect(toMarkdownLink('ENG-1 Fix it', 'https://x.test/i/ENG-1')).toBe(
      '[ENG-1 Fix it](https://x.test/i/ENG-1)',
    );
  });

  it('escapes square brackets and backslashes in the text', () => {
    expect(toMarkdownLink('ENG-1 Fix [WIP] a\\b', 'https://x.test/i')).toBe(
      '[ENG-1 Fix \\[WIP\\] a\\\\b](https://x.test/i)',
    );
  });

  it('encodes parentheses in the url so the link cannot end early', () => {
    expect(toMarkdownLink('t', 'https://x.test/a(b)')).toBe('[t](https://x.test/a%28b%29)');
  });
});
