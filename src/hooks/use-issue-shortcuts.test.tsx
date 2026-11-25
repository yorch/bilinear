import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('@/lib/toast', () => ({ toast: { error: toastError, success: toastSuccess } }));
vi.mock('@/hooks/use-translations', () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock('@/providers/store-provider', () => ({
  useStore: () => ({ userStore: { currentUser: { id: 'me' } } }),
}));

const { useChord } = await import('./use-hotkeys');
const { useIssueShortcuts } = await import('./use-issue-shortcuts');

function press(init: KeyboardEventInit, target: EventTarget = document) {
  act(() => {
    target.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }),
    );
  });
}

describe('useIssueShortcuts', () => {
  const onUpdate = vi.fn();
  const onArchive = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    onUpdate.mockReset();
    onArchive.mockReset();
  });
  afterEach(() => {
    vi.runAllTimers();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  function mount(extra: Partial<Parameters<typeof useIssueShortcuts>[0]> = {}) {
    return renderHook(() =>
      useIssueShortcuts({
        identifier: 'ENG-1',
        issueId: 'issue-1',
        onArchive,
        onUpdate,
        ...extra,
      }),
    );
  }

  it('opens the matching property popover for each single key', () => {
    const { result } = mount();
    const cases: Array<[KeyboardEventInit, string]> = [
      [{ key: 's' }, 'status'],
      [{ key: 'a' }, 'assignee'],
      [{ key: 'p' }, 'priority'],
      [{ key: 'l' }, 'label'],
      [{ key: 'd' }, 'dueDate'],
      [{ key: 'E', shiftKey: true }, 'estimate'],
      [{ key: 'P', shiftKey: true }, 'project'],
      [{ key: 'q' }, 'cycle'],
    ];
    for (const [init, expected] of cases) {
      press(init);
      expect(result.current.openProperty).toBe(expected);
      act(() => result.current.closeProperty());
      expect(result.current.openProperty).toBeNull();
    }
  });

  it('i assigns the issue to the viewer', () => {
    mount();
    press({ key: 'i' });
    expect(onUpdate).toHaveBeenCalledWith('issue-1', { assigneeId: 'me' });
  });

  it('G then I navigates (chord) without assigning to the viewer', () => {
    const chord = vi.fn();
    renderHook(() => {
      useChord('g', 'i', chord);
    });
    mount();
    press({ key: 'g' });
    press({ key: 'i' });
    expect(chord).toHaveBeenCalledTimes(1);
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('G then I does not assign when the shortcuts mounted BEFORE the chord', () => {
    mount();
    renderHook(() => {
      useChord('g', 'i', vi.fn());
    });
    press({ key: 'g' });
    press({ key: 'i' });
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('does nothing while typing in an input, textarea or contenteditable (TipTap)', () => {
    const { result } = mount();
    const input = document.createElement('input');
    const textarea = document.createElement('textarea');
    const editor = document.createElement('div');
    editor.setAttribute('contenteditable', 'true');
    // jsdom does not implement isContentEditable; mirror what a browser reports.
    Object.defineProperty(editor, 'isContentEditable', { value: true });
    document.body.append(input, textarea, editor);
    for (const el of [input, textarea, editor]) {
      press({ key: 's' }, el);
      press({ key: 'i' }, el);
      press({ key: 'Backspace' }, el);
    }
    expect(result.current.openProperty).toBeNull();
    expect(onUpdate).not.toHaveBeenCalled();
    expect(onArchive).not.toHaveBeenCalled();
  });

  it('ignores modifier combinations of the single keys', () => {
    const { result } = mount();
    press({ ctrlKey: true, key: 's' });
    press({ key: 'a', metaKey: true });
    press({ altKey: true, key: 'i' });
    expect(result.current.openProperty).toBeNull();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('Backspace and Delete archive', () => {
    mount();
    press({ key: 'Backspace' });
    press({ key: 'Delete' });
    expect(onArchive).toHaveBeenCalledTimes(2);
  });

  it('is inert until the issue has loaded or when disabled', () => {
    const { result } = mount({ issueId: undefined });
    press({ key: 's' });
    press({ key: 'i' });
    expect(result.current.openProperty).toBeNull();
    expect(onUpdate).not.toHaveBeenCalled();
    const disabled = mount({ enabled: false });
    press({ key: 's' });
    expect(disabled.result.current.openProperty).toBeNull();
  });

  it('Cmd/Ctrl+. copies the identifier and toasts; a failed copy toasts an error', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    mount();
    press({ key: '.', metaKey: true });
    await vi.waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(writeText).toHaveBeenCalledWith('ENG-1');

    writeText.mockRejectedValueOnce(new Error('denied'));
    press({ ctrlKey: true, key: '.' });
    await vi.waitFor(() => expect(toastError).toHaveBeenCalled());
  });
});
