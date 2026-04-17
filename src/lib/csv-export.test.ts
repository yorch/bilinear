import { describe, expect, it } from 'vitest';
import { csvCell, rowsToCsv } from './csv-export';

describe('csvCell', () => {
  it('returns empty string for null / undefined', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
  });

  it('passes plain strings through unquoted', () => {
    expect(csvCell('hello')).toBe('hello');
  });

  it('quotes and escapes values with commas, quotes, or newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('she said "hi"')).toBe('"she said ""hi"""');
    expect(csvCell('line1\nline2')).toBe('"line1\nline2"');
  });

  it('joins arrays with ", " before quoting', () => {
    expect(csvCell(['bug', 'urgent'])).toBe('"bug, urgent"');
  });

  it('stringifies numbers and booleans', () => {
    expect(csvCell(42)).toBe('42');
    expect(csvCell(true)).toBe('true');
  });
});

describe('rowsToCsv', () => {
  it('emits BOM + header + rows separated by CRLF', () => {
    const csv = rowsToCsv(
      ['id', 'title'],
      [
        ['1', 'Fix bug'],
        ['2', 'Add, feature'],
      ],
    );
    expect(csv).toBe('\uFEFFid,title\r\n1,Fix bug\r\n2,"Add, feature"');
  });
});
