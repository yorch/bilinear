import { describe, expect, it } from 'vitest';
import { parseNumberDraft } from './number-draft';

describe('parseNumberDraft', () => {
  it('rejects an empty draft instead of coercing it to 0', () => {
    expect(parseNumberDraft('')).toEqual({ ok: false, reason: 'empty' });
    expect(parseNumberDraft('   ')).toEqual({ ok: false, reason: 'empty' });
  });

  it('accepts a genuine 0 when the bounds allow it', () => {
    expect(parseNumberDraft('0', { min: 0 })).toEqual({ ok: true, value: 0 });
  });

  it('rejects non-numeric text', () => {
    expect(parseNumberDraft('abc')).toEqual({ ok: false, reason: 'invalid' });
    expect(parseNumberDraft('Infinity')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('enforces min and max inclusively', () => {
    expect(parseNumberDraft('0', { max: 10, min: 1 })).toEqual({ ok: false, reason: 'range' });
    expect(parseNumberDraft('11', { max: 10, min: 1 })).toEqual({ ok: false, reason: 'range' });
    expect(parseNumberDraft('1', { max: 10, min: 1 })).toEqual({ ok: true, value: 1 });
    expect(parseNumberDraft('10', { max: 10, min: 1 })).toEqual({ ok: true, value: 10 });
  });

  it('treats null bounds as unbounded', () => {
    expect(parseNumberDraft('-5', { max: null, min: null })).toEqual({ ok: true, value: -5 });
  });
});
