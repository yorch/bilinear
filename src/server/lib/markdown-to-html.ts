/**
 * Minimal, safe GitHub-flavoured-markdown → TipTap-HTML converter used by the
 * GitHub importer.
 *
 * Safety model: the input is NEVER passed through as HTML. Every text run is
 * escaped, and the only markup in the output is what this file emits itself,
 * restricted to tags the TipTap schema supports (p, h1-h6, ul/ol/li,
 * blockquote, pre>code, code, strong, em, s, a, hr, br). Consequently raw
 * `<script>`, `<img>`, event-handler attributes and `javascript:` links in the
 * source are rendered as inert text or dropped — images become plain links so
 * nothing is fetched when the issue is opened (no tracking pixels).
 */

const ESCAPES: Record<string, string> = {
  '"': '&quot;',
  '&': '&amp;',
  "'": '&#39;',
  '<': '&lt;',
  '>': '&gt;',
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, ch => ESCAPES[ch] ?? ch);
}

/** Returns a normalised http(s)/mailto URL, or null for anything else. */
export function safeHref(raw: string): string | null {
  try {
    const url = new URL(raw.trim());
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'mailto:') {
      return url.href;
    }
  } catch {
    // not a URL
  }
  return null;
}

function anchor(href: string, innerHtml: string): string {
  return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer nofollow">${innerHtml}</a>`;
}

// One alternation, earliest match wins. Groups:
// 1/2 code span, 3 image bang, 4 link text, 5 link url, 6 bare url,
// 7 bold(**), 8 bold(__), 9 strike, 10 italic(*), 11 italic(_)
const INLINE_RE =
  /(`+)([\s\S]*?[^`])\1(?!`)|(!?)\[([^\]\n]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"\n]*")?\s*\)|(https?:\/\/[^\s<>]*[^\s<>.,;:!?)'"\]])|\*\*(?=\S)([\s\S]+?\S)\*\*|__(?=\S)([\s\S]+?\S)__|~~(?=\S)([\s\S]+?\S)~~|\*(?=[^\s*])([^*\n]+?)\*|\b_(?=[^\s_])([^_\n]+?)_\b/g;

function escapeText(text: string): string {
  return escapeHtml(text).replace(/\n/g, '<br>');
}

export function renderInline(src: string, inLink = false, depth = 0): string {
  if (depth > 6) {
    return escapeText(src);
  }
  let out = '';
  let last = 0;
  const re = new RegExp(INLINE_RE.source, 'g');
  for (let m = re.exec(src); m !== null; m = re.exec(src)) {
    out += escapeText(src.slice(last, m.index));
    last = m.index + m[0].length;
    const [, , code, bang, linkText, linkUrl, bareUrl, b1, b2, strike, i1, i2] = m;
    if (code !== undefined) {
      out += `<code>${escapeHtml(code.replace(/\n/g, ' '))}</code>`;
    } else if (linkUrl !== undefined) {
      const href = safeHref(linkUrl);
      const label = linkText?.trim() || (bang ? 'image' : (linkUrl ?? ''));
      if (!href) {
        out += escapeText(label);
      } else if (inLink) {
        out += renderInline(label, true, depth + 1);
      } else {
        // Images are linked, never embedded: no fetch on view.
        out += anchor(href, renderInline(label, true, depth + 1));
      }
    } else if (bareUrl !== undefined) {
      const href = safeHref(bareUrl);
      out += href && !inLink ? anchor(href, escapeHtml(bareUrl)) : escapeText(bareUrl);
    } else if (b1 !== undefined || b2 !== undefined) {
      out += `<strong>${renderInline((b1 ?? b2) as string, inLink, depth + 1)}</strong>`;
    } else if (strike !== undefined) {
      out += `<s>${renderInline(strike, inLink, depth + 1)}</s>`;
    } else {
      out += `<em>${renderInline((i1 ?? i2) as string, inLink, depth + 1)}</em>`;
    }
  }
  return out + escapeText(src.slice(last));
}

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})\s*([^\s`]*)[^`]*$/;
const HEADING_RE = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const HR_RE = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const QUOTE_RE = /^ {0,3}>[ \t]?(.*)$/;
const LIST_RE = /^( {0,3})([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;

function isBlockStart(line: string): boolean {
  return (
    FENCE_RE.test(line) ||
    HEADING_RE.test(line) ||
    HR_RE.test(line) ||
    QUOTE_RE.test(line) ||
    LIST_RE.test(line)
  );
}

function renderBlocks(src: string, depth: number): string {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = FENCE_RE.exec(line);
    if (fence) {
      const marker = fence[1] as string;
      const body: string[] = [];
      i++;
      while (i < lines.length && !(lines[i] as string).trim().startsWith(marker)) {
        body.push(lines[i] as string);
        i++;
      }
      i++; // closing fence (or end of input)
      out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }
    const heading = HEADING_RE.exec(line);
    if (heading) {
      const level = (heading[1] as string).length;
      out.push(`<h${level}>${renderInline(heading[2] as string)}</h${level}>`);
      i++;
      continue;
    }
    if (HR_RE.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }
    if (QUOTE_RE.test(line)) {
      const inner: string[] = [];
      while (i < lines.length && QUOTE_RE.test(lines[i] as string)) {
        inner.push((QUOTE_RE.exec(lines[i] as string) as RegExpExecArray)[1] as string);
        i++;
      }
      out.push(
        `<blockquote>${depth < 4 ? renderBlocks(inner.join('\n'), depth + 1) : escapeText(inner.join('\n'))}</blockquote>`,
      );
      continue;
    }
    const list = LIST_RE.exec(line);
    if (list) {
      const ordered = /\d/.test(list[2] as string);
      const items: string[][] = [];
      while (i < lines.length) {
        const cur = lines[i] as string;
        const m = LIST_RE.exec(cur);
        if (m && /\d/.test(m[2] as string) === ordered && (m[1] as string).length < 4) {
          items.push([m[3] as string]);
          i++;
        } else if (items.length > 0 && /^( {2,}|\t)\S/.test(cur)) {
          (items[items.length - 1] as string[]).push(cur.replace(/^( {2,4}|\t)/, ''));
          i++;
        } else {
          break;
        }
      }
      const tag = ordered ? 'ol' : 'ul';
      const lis = items.map(item => {
        const body = depth < 4 ? renderBlocks(item.join('\n'), depth + 1) : escapeText(item.join(' '));
        return `<li>${body.startsWith('<p>') ? body : `<p></p>${body}`}</li>`;
      });
      out.push(`<${tag}>${lis.join('')}</${tag}>`);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && (lines[i] as string).trim() && (para.length === 0 || !isBlockStart(lines[i] as string))) {
      para.push((lines[i] as string).trim());
      i++;
    }
    out.push(`<p>${renderInline(para.join('\n'))}</p>`);
  }
  return out.join('');
}

export function markdownToHtml(markdown: string): string {
  return renderBlocks(markdown, 0);
}

/**
 * Convert and keep the HTML within `maxLength` by shrinking the markdown source
 * (never by cutting HTML, which could leave unbalanced tags).
 */
export function markdownToHtmlWithin(markdown: string, maxLength: number): string {
  let src = markdown;
  let html = markdownToHtml(src);
  while (html.length > maxLength && src.length > 0) {
    src = src.slice(0, Math.floor(src.length * Math.min(0.9, (maxLength / html.length) * 0.95)));
    html = markdownToHtml(src);
  }
  return html;
}
