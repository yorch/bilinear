import { describe, expect, it } from 'vitest';
import { translate } from '@/lib/i18n';
import en from '@/lib/i18n/locales/en.json';
import es from '@/lib/i18n/locales/es.json';
import {
  AUDIT_ACTIONS,
  auditActionLabel,
  auditResourceLabel,
  endOfDayIso,
  humanizeAction,
  resolveAuditResourceName,
  startOfDayIso,
} from './audit-action';

const tEn = (key: string) => translate('en', key);
const tEs = (key: string) => translate('es', key);

function lookup(dict: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((n, k) => (n as Record<string, unknown> | undefined)?.[k], dict);
}

describe('auditActionLabel', () => {
  it('has a translation for every known action in every locale', () => {
    for (const action of AUDIT_ACTIONS) {
      expect(typeof lookup(en, `settings.auditLog.actions.${action}`), action).toBe('string');
      expect(typeof lookup(es, `settings.auditLog.actions.${action}`), action).toBe('string');
    }
  });

  it('localises: Spanish differs from English', () => {
    expect(auditActionLabel(tEs, 'team.created')).not.toBe(auditActionLabel(tEn, 'team.created'));
  });

  it('falls back to a humanised id for an action the dictionary lacks', () => {
    expect(auditActionLabel(tEn, 'brand_new.thing_happened')).toBe('Brand new thing happened');
    expect(humanizeAction('member.role_changed')).toBe('Member role changed');
  });
});

describe('day boundaries', () => {
  it('brackets a whole local day', () => {
    const from = new Date(startOfDayIso('2026-03-05') as string);
    const to = new Date(endOfDayIso('2026-03-05') as string);
    expect(to.getTime() - from.getTime()).toBe(24 * 60 * 60 * 1000 - 1);
  });

  it('rejects garbage', () => {
    expect(startOfDayIso('nope')).toBeNull();
    expect(endOfDayIso('')).toBeNull();
  });
});

describe('auditResourceLabel', () => {
  it('localises the resource type instead of echoing the model name', () => {
    const en = auditResourceLabel(tEn, 'OrganizationMember', 'f6681a4d-0000', undefined);
    const es = auditResourceLabel(tEs, 'OrganizationMember', 'f6681a4d-0000', undefined);
    expect(en.type).toBe('Member');
    expect(es.type).not.toBe(en.type);
    expect(en.id).toBe('f6681a4d');
  });

  it('prefers a resolved name over the short id', () => {
    const r = auditResourceLabel(tEn, 'Team', 'abc-123', () => 'Engineering');
    expect(r.id).toBe('Engineering');
  });

  it('humanises an unknown type', () => {
    expect(auditResourceLabel(tEn, 'FooBar', null).type).toBe('Foo Bar');
  });
});

describe('resolveAuditResourceName', () => {
  const lookups = {
    member: (id: string) => (id === 'u1' ? 'Ada Lovelace' : null),
    team: (id: string) => (id === 't1' ? 'Engineering' : null),
  };

  it('resolves members from the user lookup, not the short id', () => {
    expect(resolveAuditResourceName('OrganizationMember', 'u1', null, lookups)).toBe(
      'Ada Lovelace',
    );
  });

  it('resolves teams', () => {
    expect(resolveAuditResourceName('Team', 't1', null, lookups)).toBe('Engineering');
  });

  it('reads a webhook name from the row metadata', () => {
    expect(resolveAuditResourceName('Webhook', 'w1', { name: 'Deploys' }, lookups)).toBe(
      'Deploys',
    );
  });

  it('returns null when unresolvable so the label falls back to the short id', () => {
    expect(resolveAuditResourceName('OrganizationMember', 'gone', null, lookups)).toBeNull();
    expect(resolveAuditResourceName('Webhook', 'w1', { name: '  ' }, lookups)).toBeNull();
    expect(resolveAuditResourceName('Webhook', 'w1', undefined, lookups)).toBeNull();
    const label = auditResourceLabel(tEn, 'Webhook', 'abcdef123456', (type, id) =>
      resolveAuditResourceName(type, id, null, lookups),
    );
    expect(label.id).toBe('abcdef12');
  });
});
