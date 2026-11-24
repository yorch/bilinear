const EMAIL_PATTERN = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/;

/**
 * A team key suggestion from the workspace name: the initials of its words
 * (`Acme Robotics` → `AR`), or the first letters of a single word
 * (`Acme` → `ACM`). The server requires 1–10 A–Z, so everything else is
 * dropped; an empty result means "nothing sensible to suggest".
 */
export function deriveTeamKey(name: string): string {
  const letters = name.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const words = letters.split(/[^A-Z]+/).filter(Boolean);
  if (words.length === 0) {
    return '';
  }
  if (words.length === 1) {
    return words[0].slice(0, 3);
  }
  return words
    .map(w => w[0])
    .join('')
    .slice(0, 5);
}

/** Keystroke sanitiser for the key field — mirrors the server pattern. */
export function sanitizeTeamKey(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 10);
}

/**
 * Split a pasted list of addresses (commas, semicolons, whitespace) into
 * unique valid ones, plus whatever was rejected so the form can say so.
 */
export function parseInviteEmails(text: string): { invalid: string[]; valid: string[] } {
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const email = raw.trim();
    if (!email) {
      continue;
    }
    if (!EMAIL_PATTERN.test(email)) {
      invalid.push(email);
      continue;
    }
    const key = email.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      valid.push(email);
    }
  }
  return { invalid, valid };
}
