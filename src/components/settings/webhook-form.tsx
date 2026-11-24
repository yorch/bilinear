'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { useTranslations } from '@/hooks/use-translations';
import { cn, TOUCH_ROW } from '@/lib/utils';

export interface WebhookFormValues {
  events: string[];
  name: string;
  url: string;
}

interface WebhookFormProps {
  availableEvents: string[];
  busy: boolean;
  /** Seeds the fields when editing an existing webhook; omit to create. */
  initial?: WebhookFormValues;
  onCancel?: () => void;
  onSubmit: (values: WebhookFormValues) => void;
  /** Defaults to the create wording. */
  submitLabel?: string;
}

/**
 * The name / URL / events form, shared by "Add webhook" and "Edit webhook" so
 * the two can never drift on validation or wording.
 */
export function WebhookForm({
  availableEvents,
  busy,
  initial,
  onCancel,
  onSubmit,
  submitLabel,
}: WebhookFormProps) {
  const t = useTranslations();
  const [name, setName] = useState(initial?.name ?? '');
  const [url, setUrl] = useState(initial?.url ?? '');
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set(initial?.events ?? []));
  const [formErrors, setFormErrors] = useState<{ events?: string; name?: string; url?: string }>(
    {},
  );
  const nameRef = useRef<HTMLInputElement>(null);
  const urlRef = useRef<HTMLInputElement>(null);
  const eventsRef = useRef<HTMLDivElement>(null);

  const submit = () => {
    const errs: typeof formErrors = {};
    if (!name.trim()) {
      errs.name = t('settings.webhooks.nameRequired');
    }
    if (!url.trim()) {
      errs.url = t('settings.webhooks.urlRequired');
    }
    if (selectedEvents.size === 0) {
      errs.events = t('settings.webhooks.eventsRequired');
    }
    setFormErrors(errs);
    if (errs.name || errs.url || errs.events) {
      if (errs.name) {
        nameRef.current?.focus();
      } else if (errs.url) {
        urlRef.current?.focus();
      } else {
        eventsRef.current?.focus();
      }
      return;
    }
    onSubmit({ events: Array.from(selectedEvents), name: name.trim(), url: url.trim() });
  };

  return (
    <div>
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="text-xs">
          <label className="mb-1 block text-foreground-secondary" htmlFor="webhook-name">
            {t('settings.webhooks.name')} <span className="text-danger">*</span>
          </label>
          <Input
            aria-describedby={formErrors.name ? 'webhook-name-error' : undefined}
            aria-invalid={formErrors.name ? true : undefined}
            data-autofocus
            id="webhook-name"
            onChange={e => {
              setName(e.target.value);
              setFormErrors(f => ({ ...f, name: undefined }));
            }}
            placeholder={t('settings.webhooks.namePlaceholder')}
            ref={nameRef}
            value={name}
          />
          {formErrors.name && (
            <p className="mt-1 text-danger-subtle-foreground" id="webhook-name-error" role="alert">
              {formErrors.name}
            </p>
          )}
        </div>
        <div className="text-xs">
          <label className="mb-1 block text-foreground-secondary" htmlFor="webhook-url">
            {t('settings.webhooks.url')} <span className="text-danger">*</span>
          </label>
          <Input
            aria-describedby={formErrors.url ? 'webhook-url-error' : undefined}
            aria-invalid={formErrors.url ? true : undefined}
            id="webhook-url"
            onChange={e => {
              setUrl(e.target.value);
              setFormErrors(f => ({ ...f, url: undefined }));
            }}
            placeholder="https://example.com/hook"
            ref={urlRef}
            value={url}
          />
          {formErrors.url && (
            <p className="mt-1 text-danger-subtle-foreground" id="webhook-url-error" role="alert">
              {formErrors.url}
            </p>
          )}
        </div>
      </div>
      <fieldset className="mb-3">
        <legend className="mb-1 flex w-full items-center justify-between text-xs text-foreground-secondary">
          <span>
            {t('settings.webhooks.events')} <span className="text-danger">*</span>
          </span>
          <button
            className="text-brand hover:underline"
            onClick={() => {
              setSelectedEvents(
                selectedEvents.size === availableEvents.length
                  ? new Set()
                  : new Set(availableEvents),
              );
              setFormErrors(f => ({ ...f, events: undefined }));
            }}
            type="button"
          >
            {selectedEvents.size === availableEvents.length
              ? t('settings.webhooks.clearAllEvents')
              : t('settings.webhooks.selectAllEvents')}
          </button>
        </legend>
        <div
          aria-describedby={formErrors.events ? 'webhook-events-error' : undefined}
          className="grid grid-cols-1 gap-1 rounded-md border border-input p-2 sm:grid-cols-2 md:grid-cols-3"
          ref={eventsRef}
          tabIndex={-1}
        >
          {availableEvents.map(e => (
            <label
              className={cn('flex min-w-0 items-center gap-1.5 text-xs', TOUCH_ROW)}
              htmlFor={`webhook-event-${e}`}
              key={e}
            >
              <Checkbox
                checked={selectedEvents.has(e)}
                id={`webhook-event-${e}`}
                onChange={() => {
                  setFormErrors(f => ({ ...f, events: undefined }));
                  setSelectedEvents(prev => {
                    const next = new Set(prev);
                    if (next.has(e)) {
                      next.delete(e);
                    } else {
                      next.add(e);
                    }
                    return next;
                  });
                }}
              />
              <span className="truncate font-mono">{e}</span>
            </label>
          ))}
        </div>
        {formErrors.events && (
          <p
            className="mt-1 text-xs text-danger-subtle-foreground"
            id="webhook-events-error"
            role="alert"
          >
            {formErrors.events}
          </p>
        )}
      </fieldset>
      <div className="flex gap-2">
        <Button disabled={busy} onClick={submit} size="sm" type="button">
          {submitLabel ?? t('settings.webhooks.createWebhook')}
        </Button>
        {onCancel && (
          <Button onClick={onCancel} size="sm" type="button" variant="ghost">
            {t('common.cancel')}
          </Button>
        )}
      </div>
    </div>
  );
}
