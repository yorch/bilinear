'use client';

import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslations } from '@/hooks/use-translations';
import { cn, TOUCH_TARGET } from '@/lib/utils';

interface ReadOnlyFieldProps {
  label: string;
  onCopy: () => void;
  value: string;
}

/**
 * A copyable, read-only value (an ACS URL, a webhook endpoint, a SCIM base URL)
 * that exists to be pasted into another system.
 *
 * The origin is not knowable until after mount (`useOrigin` returns '' on the
 * server and for the hydration pass), so a value that still starts with `/` has
 * no host yet. Copying it would hand the user a silently wrong string, so the
 * button is disabled for exactly as long as the value has no host.
 */
export function ReadOnlyField({ label, onCopy, value }: ReadOnlyFieldProps) {
  const t = useTranslations();
  const pending = value.startsWith('/');
  const copyLabel = t('settings.security.copyField', { label });
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className="mb-1 p-0 text-xs text-muted-foreground">{label}</legend>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-xs">
          {value}
        </code>
        <Button
          aria-label={copyLabel}
          className={cn('shrink-0 text-muted-foreground hover:text-foreground', TOUCH_TARGET)}
          disabled={pending}
          onClick={onCopy}
          size="icon"
          title={copyLabel}
          type="button"
          variant="ghost"
        >
          <Copy className="h-3.5 w-3.5" />
        </Button>
      </div>
    </fieldset>
  );
}
