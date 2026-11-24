/**
 * `[text](url)` with the characters that would end or corrupt the link text
 * escaped. A title such as `Fix [WIP] parser` otherwise closes the bracket
 * early and the pasted Markdown renders the wrong link.
 */
export function toMarkdownLink(text: string, url: string): string {
  const escaped = text.replace(/([\\[\]])/g, '\\$1');
  const safeUrl = url.replace(/\)/g, '%29').replace(/\(/g, '%28');
  return `[${escaped}](${safeUrl})`;
}
