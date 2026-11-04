import * as React from 'react';
import { Input } from '@/components/ui/input';

interface AuthFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Inline validation message. Marks the input invalid and is announced. */
  error?: string | null;
  /** Muted helper text under the input, linked via `aria-describedby`. */
  hint?: React.ReactNode;
  id: string;
  label: string;
  /** Content rendered inside the input row, before the input (e.g. a URL prefix). */
  leading?: React.ReactNode;
}

/**
 * Label + input + hint/error used by every auth form. Ties the message to the
 * control (`aria-describedby` / `aria-invalid`) so a screen reader announces it
 * with the field, which a bare `<p role="alert">` below the form does not.
 */
export const AuthField = React.forwardRef<HTMLInputElement, AuthFieldProps>(
  ({ error, hint, id, label, leading, className, ...props }, ref) => {
    const messageId = `${id}-message`;
    const hasMessage = Boolean(error || hint);
    const input = (
      <Input
        aria-describedby={hasMessage ? messageId : undefined}
        aria-invalid={error ? true : undefined}
        className={className}
        id={id}
        ref={ref}
        {...props}
      />
    );
    return (
      <div className="flex flex-col gap-1.5">
        <label className="text-sm font-medium text-foreground-secondary" htmlFor={id}>
          {label}
        </label>
        {leading ? (
          <div className="flex min-w-0 items-center gap-2">
            <span className="max-w-[45%] shrink-0 select-none truncate font-mono text-sm text-muted-foreground">
              {leading}
            </span>
            {input}
          </div>
        ) : (
          input
        )}
        {error ? (
          <p className="text-xs text-danger-subtle-foreground" id={messageId} role="alert">
            {error}
          </p>
        ) : (
          hint && (
            <p aria-live="polite" className="text-xs text-muted-foreground" id={messageId}>
              {hint}
            </p>
          )
        )}
      </div>
    );
  },
);
AuthField.displayName = 'AuthField';
