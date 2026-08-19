import { describe, expect, it } from 'vitest';
import {
  defaultForScope,
  getSetting,
  InvalidSettingValueError,
  numericSettingDefault,
  parseEnvValue,
  SETTINGS,
  settingsForScope,
  validateSettingValue,
} from './registry';
import type { SettingDefinition, SettingScope } from './types';
import { SCOPE_ORDER } from './types';

/**
 * These are registry *invariants*, not per-knob tests. A registry-driven system
 * fails as a whole when a declaration is malformed — a default outside its own
 * bounds, a duplicate key, a knob storable at a scope it never declares — and
 * one test per knob would neither catch those nor survive adding knob 61.
 */
describe('registry invariants', () => {
  it('has no duplicate keys', () => {
    const keys = SETTINGS.map(s => s.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('declares at least one scope for every knob', () => {
    for (const s of SETTINGS) {
      expect(s.scopes.length, s.key).toBeGreaterThan(0);
    }
  });

  it('orders every scopes list by precedence', () => {
    // Resolution walks SCOPE_ORDER and takes the last match, so a list written
    // out of order would still resolve correctly — but it would read as though
    // precedence were something else. Keeping them ordered is what makes the
    // declaration legible.
    for (const s of SETTINGS) {
      const ranks = s.scopes.map(scope => SCOPE_ORDER.indexOf(scope));
      expect(
        [...ranks].sort((a, b) => a - b),
        s.key,
      ).toEqual(ranks);
    }
  });

  it('gives every knob a default inside its own bounds', () => {
    for (const s of SETTINGS) {
      if (!s.bounds) {
        continue;
      }
      for (const scope of s.scopes) {
        const value = defaultForScope(s, scope);
        expect(typeof value, s.key).toBe('number');
        expect(value as number, `${s.key} @ ${scope}`).toBeGreaterThanOrEqual(s.bounds.min);
        expect(value as number, `${s.key} @ ${scope}`).toBeLessThanOrEqual(s.bounds.max);
      }
    }
  });

  it('gives every default a value its own validator accepts', () => {
    for (const s of SETTINGS) {
      if (s.storage === 'env-only') {
        // env-only knobs carry a placeholder default; they are never stored.
        continue;
      }
      for (const scope of s.scopes) {
        expect(() => validateSettingValue(s, defaultForScope(s, scope)), s.key).not.toThrow();
      }
    }
  });

  it('gives every enum knob a non-empty enumValues list', () => {
    for (const s of SETTINGS) {
      if (s.type === 'enum') {
        expect(s.enumValues?.length, s.key).toBeGreaterThan(0);
        expect(s.enumValues, s.key).toContain(defaultForScope(s));
      }
    }
  });

  it('redacts every env-only secret and never stores it', () => {
    for (const s of SETTINGS) {
      if (s.redacted) {
        expect(s.storage, s.key).toBe('env-only');
      }
    }
  });

  it('binds every env-only knob to an environment variable', () => {
    // An env-only knob with no env binding could never take a value from
    // anywhere — it would be a permanently-constant entry pretending to be
    // configurable.
    for (const s of SETTINGS) {
      if (s.storage === 'env-only') {
        expect(s.env?.name, s.key).toBeTruthy();
      }
    }
  });

  it('excludes env-only and deprecated knobs from every scope listing', () => {
    for (const scope of SCOPE_ORDER) {
      for (const s of settingsForScope(scope)) {
        expect(s.storage, s.key).toBe('db');
        expect(s.deprecated ?? false, s.key).toBe(false);
        expect(s.scopes, s.key).toContain(scope);
      }
    }
  });

  it('uses dotted lowercase keys', () => {
    for (const s of SETTINGS) {
      expect(s.key, s.key).toMatch(/^[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)+$/);
    }
  });
});

describe('validateSettingValue', () => {
  const intKnob = getSetting('limits.maxInitiativeDepth') as SettingDefinition;

  it('accepts an in-range integer', () => {
    expect(validateSettingValue(intKnob, 4)).toBe(4);
  });

  it('rejects a non-integer for an int knob', () => {
    expect(() => validateSettingValue(intKnob, 4.5)).toThrow(InvalidSettingValueError);
  });

  it('rejects below the minimum and above the maximum', () => {
    expect(() => validateSettingValue(intKnob, 0)).toThrow(InvalidSettingValueError);
    expect(() => validateSettingValue(intKnob, 21)).toThrow(InvalidSettingValueError);
  });

  it('coerces a numeric string, since form inputs submit strings', () => {
    expect(validateSettingValue(intKnob, '7')).toBe(7);
  });

  it('rejects a non-numeric string', () => {
    expect(() => validateSettingValue(intKnob, 'abc')).toThrow(InvalidSettingValueError);
  });

  it('rejects a boolean for an int knob', () => {
    expect(() => validateSettingValue(intKnob, true)).toThrow(InvalidSettingValueError);
  });

  it('enforces the enum member list', () => {
    const enumKnob = getSetting('ai.provider') as SettingDefinition;
    expect(validateSettingValue(enumKnob, 'openai')).toBe('openai');
    expect(() => validateSettingValue(enumKnob, 'gemini')).toThrow(InvalidSettingValueError);
  });

  it('requires a real boolean for a boolean knob', () => {
    const boolKnob = getSetting('security.allowPrivateWebhookUrls') as SettingDefinition;
    expect(validateSettingValue(boolKnob, true)).toBe(true);
    expect(() => validateSettingValue(boolKnob, 'true')).toThrow(InvalidSettingValueError);
  });
});

describe('parseEnvValue', () => {
  const intKnob = getSetting('webhook.maxAttempts') as SettingDefinition;
  const boolKnob = getSetting('security.allowPrivateWebhookUrls') as SettingDefinition;

  it('treats unset and empty as absent', () => {
    expect(parseEnvValue(intKnob, undefined)).toBeNull();
    expect(parseEnvValue(intKnob, '')).toBeNull();
  });

  it('parses a valid numeric string', () => {
    expect(parseEnvValue(intKnob, '9')).toBe(9);
  });

  it('returns null rather than throwing on a malformed value', () => {
    // env is a *layer*: a bad value must fall through to the layer below, not
    // stop the process from booting.
    expect(parseEnvValue(intKnob, 'nope')).toBeNull();
    expect(parseEnvValue(intKnob, '999')).toBeNull();
  });

  it('accepts both spellings of a boolean flag', () => {
    for (const truthy of ['1', 'true', 'TRUE']) {
      expect(parseEnvValue(boolKnob, truthy), truthy).toBe(true);
    }
    for (const falsy of ['0', 'false', 'FALSE']) {
      expect(parseEnvValue(boolKnob, falsy), falsy).toBe(false);
    }
    expect(parseEnvValue(boolKnob, 'maybe')).toBeNull();
  });
});

describe('defaultForScope', () => {
  it('returns the scalar default when there is no per-scope map', () => {
    const knob = getSetting('limits.maxExportRows') as SettingDefinition;
    expect(defaultForScope(knob, 'org')).toBe(10_000);
  });

  it('prefers the requested scope in a per-scope map', () => {
    const knob: SettingDefinition = {
      default: { org: 3, platform: 1 } as Partial<Record<SettingScope, number>>,
      editableBy: 'platform-admin',
      key: 'test.perScope',
      labelKey: 'x',
      scopes: ['platform', 'org'],
      storage: 'db',
      type: 'int',
      visibleTo: 'member',
    };
    expect(defaultForScope(knob, 'org')).toBe(3);
    expect(defaultForScope(knob, 'platform')).toBe(1);
  });

  it('falls back to the highest-precedence declared scope when the map omits one', () => {
    const knob: SettingDefinition = {
      default: { platform: 1 } as Partial<Record<SettingScope, number>>,
      editableBy: 'platform-admin',
      key: 'test.partialMap',
      labelKey: 'x',
      scopes: ['platform', 'org', 'team'],
      storage: 'db',
      type: 'int',
      visibleTo: 'member',
    };
    expect(defaultForScope(knob, 'team')).toBe(1);
  });
});

describe('numericSettingDefault', () => {
  it('throws on an unknown key so a typo fails at module load', () => {
    expect(() => numericSettingDefault('nope.missing')).toThrow();
  });

  it('throws when the knob is not numeric', () => {
    expect(() => numericSettingDefault('ai.provider')).toThrow();
  });
});
