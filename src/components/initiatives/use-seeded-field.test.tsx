import { act, renderHook } from '@testing-library/react';
import type { ChangeEvent } from 'react';
import { describe, expect, it } from 'vitest';
import { useSeededField } from './use-seeded-field';

const change = (value: string) => ({ target: { value } }) as ChangeEvent<HTMLInputElement>;

describe('useSeededField', () => {
  it('follows the stored value while the field is idle', () => {
    const { result, rerender } = renderHook(({ stored }) => useSeededField(stored), {
      initialProps: { stored: 'a' },
    });
    rerender({ stored: 'b' });
    expect(result.current.value).toBe('b');
  });

  it('does not wipe typing when a remote edit lands while the field has focus and is dirty', () => {
    const { result, rerender } = renderHook(({ stored }) => useSeededField(stored), {
      initialProps: { stored: 'old' },
    });
    act(() => result.current.inputProps.onFocus());
    act(() => result.current.inputProps.onChange(change('my half-typed')));

    rerender({ stored: 'remote edit' });

    expect(result.current.value).toBe('my half-typed');
  });

  it('does not overwrite a focused but untouched field either', () => {
    const { result, rerender } = renderHook(({ stored }) => useSeededField(stored), {
      initialProps: { stored: 'old' },
    });
    act(() => result.current.inputProps.onFocus());
    rerender({ stored: 'remote edit' });
    expect(result.current.value).toBe('old');
  });

  it('on blur without typing, adopts the newer stored value and reports nothing to commit', () => {
    const { result, rerender } = renderHook(({ stored }) => useSeededField(stored), {
      initialProps: { stored: 'old' },
    });
    act(() => result.current.inputProps.onFocus());
    rerender({ stored: 'remote edit' });
    let didType = true;
    act(() => {
      didType = result.current.finish();
    });
    expect(didType).toBe(false);
    expect(result.current.value).toBe('remote edit');
  });

  it('on blur after typing, reports a commit and re-seeds on a later rollback', () => {
    const { result, rerender } = renderHook(({ stored }) => useSeededField(stored), {
      initialProps: { stored: 'old' },
    });
    act(() => result.current.inputProps.onFocus());
    act(() => result.current.inputProps.onChange(change('new')));
    let didType = false;
    act(() => {
      didType = result.current.finish();
    });
    expect(didType).toBe(true);
    // Optimistic write lands, then the server refuses and the store rolls back.
    rerender({ stored: 'new' });
    rerender({ stored: 'old' });
    expect(result.current.value).toBe('old');
  });

  it('reset drops the draft', () => {
    const { result } = renderHook(() => useSeededField('stored'));
    act(() => result.current.inputProps.onChange(change('draft')));
    act(() => result.current.reset());
    expect(result.current.value).toBe('stored');
  });
});
