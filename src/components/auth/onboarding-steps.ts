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

/** The post-create steps that can be resumed from the URL (step 1 never is). */
export type ResumeStep = 'invite' | 'team';

/** `?step=` value → a resumable step, or null for anything else. */
export function parseResumeStep(value: string | string[] | undefined): ResumeStep | null {
  const v = Array.isArray(value) ? value[0] : value;
  return v === 'team' || v === 'invite' ? v : null;
}

/**
 * Where a refresh of step 2/3 lands. The step lives in the URL (not only in
 * component state) so a reload does not drop the visitor back onto the
 * "create workspace" form — where re-submitting would mint a duplicate. The
 * server re-validates that the viewer owns `urlKey` before trusting it.
 */
export function onboardingResumeUrl(step: ResumeStep, urlKey: string): string {
  return `/onboarding?${new URLSearchParams({ org: urlKey, step }).toString()}`;
}
