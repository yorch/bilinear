import { describe, expect, it } from 'vitest';
import {
  MAX_MARKDOWN_SOURCE_LENGTH,
  markdownToHtml,
  markdownToHtmlWithin,
  safeHref,
} from './markdown-to-html';

describe('markdownToHtml', () => {
  it('keeps headings, paragraphs, line breaks, lists and code blocks', () => {
    const html = markdownToHtml(
      '# Title\n\nline one\nline two\n\n- a\n- b **bold**\n\n1. x\n2. y\n\n```js\nconst a = "<b>";\n```',
    );
    expect(html).toContain('<h1>Title</h1>');
    expect(html).toContain('<p>line one<br>line two</p>');
    expect(html).toContain('<ul><li><p>a</p></li><li><p>b <strong>bold</strong></p></li></ul>');
    expect(html).toContain('<ol><li><p>x</p></li><li><p>y</p></li></ol>');
    expect(html).toContain('<pre><code>const a = &quot;&lt;b&gt;&quot;;</code></pre>');
  });

  it('renders inline code, emphasis, strike, quotes and rules', () => {
    const html = markdownToHtml('`x<y` *em* ~~gone~~ **b**\n\n> quoted\n\n---');
    expect(html).toContain('<code>x&lt;y</code>');
    expect(html).toContain('<em>em</em>');
    expect(html).toContain('<s>gone</s>');
    expect(html).toContain('<blockquote><p>quoted</p></blockquote>');
    expect(html).toContain('<hr>');
  });

  it('turns **@login** into bold text, never literal asterisks', () => {
    expect(markdownToHtml('**@octocat** commented on 2024-01-01:')).toBe(
      '<p><strong>@octocat</strong> commented on 2024-01-01:</p>',
    );
  });

  it('links with a rel-safe anchor', () => {
    const html = markdownToHtml('[docs](https://example.com/a?b=1&c="2") and https://x.test/p.');
    expect(html).toContain(
      '<a href="https://example.com/a?b=1&amp;c=%222%22" target="_blank" rel="noopener noreferrer nofollow">docs</a>',
    );
    expect(html).toContain('rel="noopener noreferrer nofollow">https://x.test/p</a>.');
  });

  describe('malicious input', () => {
    it('escapes raw html: no live img/script/iframe/handlers', () => {
      const html = markdownToHtml(
        '<img src="https://evil.test/p.gif" onerror="alert(1)">\n\n<script>alert(1)</script>\n\n<iframe src=x></iframe><a href="javascript:alert(1)" onclick="x()">k</a>',
      );
      expect(html).not.toMatch(/<(img|script|iframe)/i);
      expect(html).not.toMatch(/<a [^>]*(onclick|javascript)/i);
      expect(html).toContain('&lt;img');
    });

    it('never embeds markdown images (no tracking pixel) and drops unsafe schemes', () => {
      const html = markdownToHtml(
        '![px](https://evil.test/p.gif) [x](javascript:alert(1)) [y](data:text/html;base64,AAA) [z](vbscript:x) ![q](javascript:1)',
      );
      expect(html).not.toContain('<img');
      expect(html).toContain('href="https://evil.test/p.gif"');
      expect(html).not.toMatch(/href="(javascript|data|vbscript)/i);
    });

    it('cannot break out of an attribute or a code block', () => {
      const html = markdownToHtml(
        '[a](https://x.test/"onmouseover="alert(1)) \n\n```\n</code></pre><script>x</script>\n```',
      );
      expect(html).not.toMatch(/"onmouseover=/);
      expect(html).not.toContain('<script');
      expect(html).toContain('&lt;/code&gt;&lt;/pre&gt;');
    });

    it('survives pathological nesting without blowing up', () => {
      const html = markdownToHtml(`${'> '.repeat(200)}deep\n\n${'*a '.repeat(500)}`);
      expect(typeof html).toBe('string');
    });
  });

  it('safeHref allows only http(s) and mailto', () => {
    expect(safeHref('https://a.test')).toBe('https://a.test/');
    expect(safeHref('mailto:a@b.test')).toBe('mailto:a@b.test');
    expect(safeHref('JaVaScRiPt:alert(1)')).toBeNull();
    expect(safeHref('//evil.test')).toBeNull();
  });

  it('markdownToHtmlWithin never exceeds the cap and never leaves a cut tag', () => {
    const html = markdownToHtmlWithin('**bold** word\n\n'.repeat(5000), 2000);
    expect(html.length).toBeLessThanOrEqual(2000);
    expect(html.endsWith('</p>')).toBe(true);
  });
});

describe('markdownToHtml on pathological input', () => {
  // Unclosed `__` / `~~` openers used to rescan to end of input each (quadratic):
  // 64 KB took ~270 ms and 256 KB ~4.9 s on the request thread.
  const cases: Array<[string, string]> = [
    ['unclosed __', ' __a'],
    ['unclosed ~~', ' ~~a'],
    ['unclosed ** ', '**a '],
    ['unclosed __ per line', '__a\n'],
  ];
  for (const [name, unit] of cases) {
    for (const bytes of [64 * 1024, 256 * 1024]) {
      it(`${name} at ${bytes / 1024} KB converts in under 50 ms`, () => {
        const src = unit.repeat(Math.ceil(bytes / unit.length));
        // Best of three: a loaded CI box can stall one run, but the quadratic
        // regression is 5-100x over budget on every run.
        let best = Number.POSITIVE_INFINITY;
        for (let i = 0; i < 3; i++) {
          const started = performance.now();
          markdownToHtml(src);
          best = Math.min(best, performance.now() - started);
        }
        expect(best).toBeLessThan(50);
      });
    }
  }

  it('ignores source beyond the conversion ceiling', () => {
    const html = markdownToHtml(`${'a'.repeat(MAX_MARKDOWN_SOURCE_LENGTH)}TAILMARKER`);
    expect(html).not.toContain('TAILMARKER');
  });

  it('still renders ordinary emphasis', () => {
    expect(markdownToHtml('__bb__ ~~ss~~ **cc** *ii*')).toBe(
      '<p><strong>bb</strong> <s>ss</s> <strong>cc</strong> <em>ii</em></p>',
    );
  });
});
