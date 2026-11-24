/**
 * Every action the server writes (`AuditAction` in audit-log.service.ts). The
 * page's filter dropdown and its labels both derive from this list.
 */
export const AUDIT_ACTIONS = [
  'api_key.created',
  'api_key.revoked',
  'audit_log.exported',
  'auth.login',
  'auth.login_failed',
  'auth.logout',
  'github.webhook_secret_revealed',
  'github.webhook_secret_rotated',
  'issue.archived',
  'issue.bulk_updated',
  'issue.created',
  'issue.deleted',
  'member.invite_accepted',
  'member.invite_revoked',
  'member.invited',
  'member.left',
  'member.removed',
  'member.role_changed',
  'project.created',
  'project.deleted',
  'saml.configured',
  'saml.disabled',
  'saml.enabled',
  'scim.token_created',
  'scim.token_revoked',
  'settings.config_changed',
  'settings.security_changed',
  'team.created',
  'team.deleted',
  'webhook.archived',
  'webhook.created',
  'webhook.deleted',
  'webhook.secret_rotated',
  'webhook.tested',
  'webhook.updated',
] as const;

/** 'member.role_changed' -> 'Member role changed'. English-only last resort. */
export function humanizeAction(action: string): string {
  const text = action.replace(/[._]/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Localised label for an audit action. A missing translation makes `t()` echo
 * the key back, which is how an action the dictionary does not know yet (a new
 * server-side `AuditAction`) is detected and humanised instead of rendering a
 * dotted path.
 */
export function auditActionLabel(
  t: (key: string, params?: Record<string, string | number>) => string,
  action: string,
): string {
  const key = `settings.auditLog.actions.${action}`;
  const label = t(key);
  return label === key ? humanizeAction(action) : label;
}

/** `YYYY-MM-DD` (a date input value) -> ISO instant at the start of that local day. */
export function startOfDayIso(date: string): string | null {
  const d = new Date(`${date}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** `YYYY-MM-DD` -> ISO instant at the last millisecond of that local day. */
export function endOfDayIso(date: string): string | null {
  const d = new Date(`${date}T23:59:59.999`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
