import { describe, expect, it } from 'vitest';
import { buildActionConfig, EMPTY_ACTION_DRAFT } from './automation-action-fields';

describe('buildActionConfig', () => {
  it('builds a numeric priority config', () => {
    expect(buildActionConfig('set_priority', { ...EMPTY_ACTION_DRAFT, priority: '2' })).toEqual({
      priority: 2,
    });
  });

  it('accepts priority 0 (no priority) rather than treating it as missing', () => {
    expect(buildActionConfig('set_priority', { ...EMPTY_ACTION_DRAFT, priority: '0' })).toEqual({
      priority: 0,
    });
  });

  it('rejects an out-of-range or non-numeric priority', () => {
    expect(buildActionConfig('set_priority', { ...EMPTY_ACTION_DRAFT, priority: '9' })).toBeNull();
    expect(buildActionConfig('set_priority', { ...EMPTY_ACTION_DRAFT, priority: '' })).toBeNull();
  });

  it('requires a state for set_state', () => {
    expect(buildActionConfig('set_state', EMPTY_ACTION_DRAFT)).toBeNull();
    expect(buildActionConfig('set_state', { ...EMPTY_ACTION_DRAFT, stateId: 's1' })).toEqual({
      stateId: 's1',
    });
  });

  it('maps an empty assignee pick to an explicit unassign', () => {
    expect(buildActionConfig('set_assignee', EMPTY_ACTION_DRAFT)).toEqual({ assigneeId: null });
    expect(buildActionConfig('set_assignee', { ...EMPTY_ACTION_DRAFT, assigneeId: 'u1' })).toEqual({
      assigneeId: 'u1',
    });
  });

  it('requires a label and a non-blank comment body', () => {
    expect(buildActionConfig('add_label', EMPTY_ACTION_DRAFT)).toBeNull();
    expect(buildActionConfig('add_label', { ...EMPTY_ACTION_DRAFT, labelId: 'l1' })).toEqual({
      labelId: 'l1',
    });
    expect(buildActionConfig('post_comment', { ...EMPTY_ACTION_DRAFT, body: '   ' })).toBeNull();
    expect(buildActionConfig('post_comment', { ...EMPTY_ACTION_DRAFT, body: ' hi ' })).toEqual({
      body: 'hi',
    });
  });

  it('never builds a config for an action type it does not know', () => {
    expect(buildActionConfig('teleport', EMPTY_ACTION_DRAFT)).toBeNull();
  });
});
