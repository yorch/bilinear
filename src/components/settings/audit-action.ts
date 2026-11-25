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

/**
 * Display text for an audit row's Resource column: the localised type plus the
 * best name we can resolve (`resolveName`, from the client stores), else the
 * short id. The raw model name ("OrganizationMember") is never shown to people.
 */
export function auditResourceLabel(
  t: (key: string, params?: Record<string, string | number>) => string,
  resourceType: string,
  resourceId: string | null,
  resolveName?: (type: string, id: string) => string | null,
): { id: string | null; type: string } {
  const key = `settings.auditLog.resourceTypes.${resourceType}`;
  const translated = t(key);
  const type =
    translated === key
      ? resourceType.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase())
      : translated;
  if (!resourceId) {
    return { id: null, type };
  }
  return { id: resolveName?.(resourceType, resourceId) ?? resourceId.slice(0, 8), type };
}

export interface AuditNameLookups {
  member: (id: string) => string | null;
  team: (id: string) => string | null;
}

/**
 * Best human name for an audit row's resource. Members and teams come from the
 * client stores; a webhook has no store, but every webhook audit row records
 * its `name` in metadata (which also survives the webhook being deleted).
 * Null when nothing resolves, so the caller falls back to the short id.
 */
export function resolveAuditResourceName(
  type: string,
  id: string,
  metadata: Record<string, unknown> | null | undefined,
  lookups: AuditNameLookups,
): string | null {
  if (type === 'Team') {
    return lookups.team(id);
  }
  if (type === 'OrganizationMember') {
    return lookups.member(id);
  }
  if (type === 'Webhook') {
    const name = metadata?.name;
    return typeof name === 'string' && name.trim() ? name : null;
  }
  return null;
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
