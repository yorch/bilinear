import { describe, expect, it } from 'vitest';
import { safeRelativePath } from './safe-path';

describe('safeRelativePath', () => {
  it('accepts an ordinary in-app path', () => {
    expect(safeRelativePath('/invite/abc123')).toBe('/invite/abc123');
    expect(safeRelativePath('/acme/team/ENG?filter=open')).toBe('/acme/team/ENG?filter=open');
  });

  it('rejects a protocol-relative URL', () => {
    // The trap this guard exists for: `//evil.example.com` starts with a
    // slash but is an absolute URL, and browsers navigate off-origin.
    expect(safeRelativePath('//evil.example.com')).toBeNull();
    expect(safeRelativePath('//evil.example.com/invite/abc')).toBeNull();
  });

  it('rejects absolute URLs and bare segments', () => {
    expect(safeRelativePath('https://evil.example.com')).toBeNull();
    expect(safeRelativePath('javascript:alert(1)')).toBeNull();
    expect(safeRelativePath('acme/team/ENG')).toBeNull();
  });

  it('rejects backslashes and control characters', () => {
    // Both are browser-normalization tricks for smuggling a scheme or an
    // authority past a naive "starts with /" check.
    expect(safeRelativePath('/\\evil.example.com')).toBeNull();
    expect(safeRelativePath('/\thttps://evil.example.com')).toBeNull();
    expect(safeRelativePath('/\nfoo')).toBeNull();
  });

  it('rejects empty and absent values', () => {
    expect(safeRelativePath('')).toBeNull();
    expect(safeRelativePath(null)).toBeNull();
    expect(safeRelativePath(undefined)).toBeNull();
  });
});
