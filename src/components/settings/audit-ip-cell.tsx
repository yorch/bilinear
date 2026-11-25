'use client';

import { useTranslations } from '@/hooks/use-translations';

/**
 * The IP cell of an audit-log row. A null address is expected whenever the
 * server cannot trust forwarding headers (`TRUST_PROXY_HEADERS` unset), so the
 * placeholder explains itself instead of reading as a bug.
 */
export function AuditIpCell({ ip }: { ip: string | null }) {
  const t = useTranslations();
  if (ip) {
    return <span className="font-mono text-xs text-muted-foreground">{ip}</span>;
  }
  const label = t('settings.auditLog.ipUnavailable');
  return (
    <span className="cursor-help text-xs text-foreground-faint" title={label}>
      —<span className="sr-only">{label}</span>
    </span>
  );
}
