import { describe, expect, it, vi } from 'vitest';
import { createMockContext } from '../../../test/context-mock';
import { TEST_ORG, TEST_USER } from '../../../test/fixtures';
import { customViewResolvers } from './custom-view';

const VIEW = {
  archivedAt: null,
  creatorId: TEST_USER.id,
  id: '00000000-0000-0000-0000-0000000000c1',
  organizationId: TEST_ORG.id,
  shared: false,
  teamId: null,
};

async function update(before: { shared: boolean }, after: { shared: boolean }) {
  const ctx = createMockContext();
  // The shared mock context does not wire a CustomViewService; stub the two calls.
  (ctx.services as unknown as Record<string, unknown>).customView = {
    findById: async () => ({ ...VIEW, ...before }),
    update: async () => ({ ...VIEW, ...after }),
  };
  const spy = vi.spyOn(ctx.services.sync, 'createSyncAction');
  await customViewResolvers.Mutation.customViewUpdate(
    {},
    { id: VIEW.id, input: { shared: after.shared } },
    ctx as never,
  );
  return spy.mock.calls[0];
}

describe('customViewUpdate sync action', () => {
  it('emits an INSERT when an unshared view becomes shared (others never had it)', async () => {
    const call = await update({ shared: false }, { shared: true });
    expect(call?.[1]).toBe('I');
  });

  it('emits an UPDATE when a shared view becomes unshared (the filter turns it into a delete for others)', async () => {
    const call = await update({ shared: true }, { shared: false });
    expect(call?.[1]).toBe('U');
  });

  it('emits an UPDATE for an edit that leaves sharing alone', async () => {
    const call = await update({ shared: true }, { shared: true });
    expect(call?.[1]).toBe('U');
  });
});
