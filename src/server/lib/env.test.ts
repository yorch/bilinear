import { afterEach, describe, expect, it } from 'vitest';
import { boolEnv, numericEnv } from './env';

const TEST_ENV_KEYS = ['TEST_NUMERIC_ENV', 'TEST_BOOL_ENV'];

afterEach(() => {
  for (const k of TEST_ENV_KEYS) {
    delete process.env[k];
  }
});

describe('numericEnv', () => {
  it('returns the default when unset', () => {
    expect(numericEnv('TEST_NUMERIC_ENV', { default: 3001, max: 65535, min: 1 })).toBe(3001);
  });

  it('returns the default when set to an empty string', () => {
    process.env.TEST_NUMERIC_ENV = '';
    expect(numericEnv('TEST_NUMERIC_ENV', { default: 3001, max: 65535, min: 1 })).toBe(3001);
  });

  it('parses a valid in-range value', () => {
    process.env.TEST_NUMERIC_ENV = '4000';
    expect(numericEnv('TEST_NUMERIC_ENV', { default: 3001, max: 65535, min: 1 })).toBe(4000);
  });

  it('throws a clear error on a non-numeric value (the NaN-fix case)', () => {
    process.env.TEST_NUMERIC_ENV = 'not-a-number';
    expect(() => numericEnv('TEST_NUMERIC_ENV', { default: 3001, max: 65535, min: 1 })).toThrow(
      /Invalid TEST_NUMERIC_ENV/,
    );
  });

  it('throws on a value below min', () => {
    process.env.TEST_NUMERIC_ENV = '0';
    expect(() => numericEnv('TEST_NUMERIC_ENV', { default: 3001, max: 65535, min: 1 })).toThrow(
      /Invalid TEST_NUMERIC_ENV/,
    );
  });

  it('throws on a value above max', () => {
    process.env.TEST_NUMERIC_ENV = '99999';
    expect(() => numericEnv('TEST_NUMERIC_ENV', { default: 3001, max: 65535, min: 1 })).toThrow(
      /Invalid TEST_NUMERIC_ENV/,
    );
  });

  it('accepts a value exactly at the boundaries', () => {
    process.env.TEST_NUMERIC_ENV = '1';
    expect(numericEnv('TEST_NUMERIC_ENV', { default: 3001, max: 65535, min: 1 })).toBe(1);
    process.env.TEST_NUMERIC_ENV = '65535';
    expect(numericEnv('TEST_NUMERIC_ENV', { default: 3001, max: 65535, min: 1 })).toBe(65535);
  });
});

describe('boolEnv', () => {
  it('is false when unset', () => {
    expect(boolEnv('TEST_BOOL_ENV')).toBe(false);
  });

  it('is true for the exact string "1"', () => {
    process.env.TEST_BOOL_ENV = '1';
    expect(boolEnv('TEST_BOOL_ENV')).toBe(true);
  });

  it('is false for any other value, including "true"', () => {
    process.env.TEST_BOOL_ENV = 'true';
    expect(boolEnv('TEST_BOOL_ENV')).toBe(false);
    process.env.TEST_BOOL_ENV = '0';
    expect(boolEnv('TEST_BOOL_ENV')).toBe(false);
  });
});
