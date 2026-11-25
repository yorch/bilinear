import { describe, expect, it } from 'vitest';
import { csvSafeText } from './csv-safe';

describe('csvSafeText', () => {
  it.each(['=SUM(A1)', '+1', '-1', '@x', '\tx', '\rx'])('prefixes %j', v => {
    expect(csvSafeText(v)).toBe(`'${v}`);
  });
  it('leaves ordinary text alone', () => {
    expect(csvSafeText('Bug fixes - Q3')).toBe('Bug fixes - Q3');
    expect(csvSafeText('')).toBe('');
  });
});
