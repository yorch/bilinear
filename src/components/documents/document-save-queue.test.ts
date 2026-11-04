import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createSaveQueue,
  type SaveCallbacks,
  type SaveField,
  type SaveStatus,
} from './document-save-queue';

describe('createSaveQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup() {
    const sent: Array<{ field: SaveField; value: string; cbs: SaveCallbacks }> = [];
    const statuses: SaveStatus[] = [];
    const queue = createSaveQueue({
      onStatus: s => statuses.push(s),
      send: (field, value, cbs) => sent.push({ cbs, field, value }),
    });
    return { queue, sent, statuses };
  }

  it('saves title and body independently when both are edited inside the debounce window', () => {
    const { queue, sent } = setup();
    queue.schedule('title', 'My title');
    vi.advanceTimersByTime(300);
    queue.schedule('content', '<p>body</p>');
    vi.advanceTimersByTime(1000);
    expect(sent.map(s => [s.field, s.value])).toEqual([
      ['title', 'My title'],
      ['content', '<p>body</p>'],
    ]);
  });

  it('debounces repeated edits to one field to the latest value', () => {
    const { queue, sent } = setup();
    queue.schedule('title', 'a');
    queue.schedule('title', 'ab');
    queue.schedule('title', 'abc');
    vi.advanceTimersByTime(1000);
    expect(sent).toHaveLength(1);
    expect(sent[0].value).toBe('abc');
  });

  it('flush sends pending fields immediately and nothing fires afterwards', () => {
    const { queue, sent } = setup();
    queue.schedule('title', 't');
    queue.schedule('content', 'c');
    queue.flush();
    expect(sent).toHaveLength(2);
    vi.advanceTimersByTime(5000);
    expect(sent).toHaveLength(2);
  });

  it('reports saving then saved, and error on failure', () => {
    const { queue, sent, statuses } = setup();
    queue.schedule('title', 't');
    vi.advanceTimersByTime(1000);
    sent[0].cbs.onSuccess();
    expect(statuses).toEqual(['saving', 'saved']);

    queue.schedule('title', 'u');
    vi.advanceTimersByTime(1000);
    sent[1].cbs.onError();
    expect(statuses.at(-1)).toBe('error');
  });

  it('cancel drops pending edits', () => {
    const { queue, sent } = setup();
    queue.schedule('content', 'c');
    queue.cancel();
    vi.advanceTimersByTime(2000);
    expect(sent).toHaveLength(0);
  });

  it('a later success on another field does not hide a failed save, and retry re-sends it', () => {
    const { queue, sent, statuses } = setup();
    queue.schedule('title', 't');
    queue.schedule('content', 'c');
    vi.advanceTimersByTime(1000);
    sent[0].cbs.onError(); // title fails
    sent[1].cbs.onSuccess(); // body succeeds
    expect(statuses.at(-1)).toBe('error');
    queue.retry();
    expect(sent[2]).toMatchObject({ field: 'title', value: 't' });
    sent[2].cbs.onSuccess();
    expect(statuses.at(-1)).toBe('saved');
  });

  it('cancel with nothing sent returns to idle, not saved', () => {
    const { queue, statuses } = setup();
    queue.schedule('content', 'c');
    queue.cancel();
    expect(statuses.at(-1)).toBe('idle');
  });

  it('isDirty covers the in-flight window after the debounce timer has fired', () => {
    const { queue, sent } = setup();
    queue.schedule('title', 'abc');
    expect(queue.isDirty('title')).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(queue.hasPending('title')).toBe(false);
    expect(queue.isDirty('title')).toBe(true);
    sent[0].cbs.onSuccess();
    expect(queue.isDirty('title')).toBe(false);
  });
});
