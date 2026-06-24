import { describe, expect, it } from 'vitest';
import { IDENTIFIER_RE } from './identifiers';

describe('IDENTIFIER_RE', () => {
  it('matches a canonical identifier', () => {
    expect(IDENTIFIER_RE.test('ENG-42')).toBe(true);
  });

  it('matches a multi-letter team key', () => {
    expect(IDENTIFIER_RE.test('DESIGN-1')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(IDENTIFIER_RE.test('eng-42')).toBe(true);
  });

  it('rejects identifiers without a number', () => {
    expect(IDENTIFIER_RE.test('ENG-')).toBe(false);
    expect(IDENTIFIER_RE.test('ENG')).toBe(false);
  });

  it('rejects a numeric team key', () => {
    expect(IDENTIFIER_RE.test('123-42')).toBe(false);
  });

  it('rejects leading/trailing whitespace (anchored)', () => {
    expect(IDENTIFIER_RE.test(' ENG-42')).toBe(false);
    expect(IDENTIFIER_RE.test('ENG-42 ')).toBe(false);
  });

  it('rejects malformed separators', () => {
    expect(IDENTIFIER_RE.test('ENG 42')).toBe(false);
    expect(IDENTIFIER_RE.test('ENG-42-1')).toBe(false);
    expect(IDENTIFIER_RE.test('ENG-4.2')).toBe(false);
  });
});
