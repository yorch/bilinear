/**
 * Store-time access enforcement over a real socket: a real Hocuspocus server
 * (the module's own `server` config) and a real `@hocuspocus/provider`
 * client, with a mutable in-memory access model so access can be revoked AFTER
 * the connection is up. What is asserted is persistence — `prisma.*.update`
 * (the write to Postgres) must not run for an edit from a writer who is
 * revoked, a guest, or not in the private team.
 *
 * Each "cannot persist" case is paired with a control in which the identical
 * edit from a still-entitled user IS persisted, so the zero-write assertions
 * cannot pass merely because nothing is ever stored.
 */
import { createRequire } from 'node:module';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const DOC_ID = '00000000-0000-0000-0000-00000000d0c1';
const ISSUE_ID = '00000000-0000-0000-0000-00000000a0a1';
const TEAM_ID = '00000000-0000-0000-0000-0000000000aa';
const ORG = '00000000-0000-0000-0000-0000000000f0';

const state = vi.hoisted(() => ({
  active: new Set<string>(),
  issue: { assigneeId: null as string | null, creatorId: null as string | null },
  roles: {} as Record<string, string>,
  // userId -> in the (private) team
  teamMembers: new Set<string>(),
  writes: [] as string[],
}));

vi.mock('@/server/lib/jwt', () => ({
  verifyWsTicket: async (t: string) => ({
    orgId: '00000000-0000-0000-0000-0000000000f0',
    userId: t,
  }),
}));
vi.mock('@/server/lib/prisma', () => ({
  prisma: {
    document: {
      findFirst: async () => ({
        contentState: null,
        id: '00000000-0000-0000-0000-00000000d0c1',
        teamId: '00000000-0000-0000-0000-0000000000aa',
      }),
      update: async () => {
        state.writes.push('document');
      },
    },
    issue: {
      findFirst: async () => ({
        ...state.issue,
        descriptionState: null,
        id: '00000000-0000-0000-0000-00000000a0a1',
        teamId: '00000000-0000-0000-0000-0000000000aa',
      }),
      update: async () => {
        state.writes.push('issue');
      },
    },
    organization: { findUnique: async () => ({ archivedAt: null, suspendedAt: null }) },
    organizationMember: { findUnique: async () => ({ role: 'member' }) },
    teamMemberRole: {
      findUnique: async ({ where }: { where: { teamId_userId: { userId: string } } }) => {
        const role = state.roles[where.teamId_userId.userId];
        return role ? { role } : null;
      },
    },
    teamMembership: {
      findUnique: async ({ where }: { where: { teamId_userId: { userId: string } } }) =>
        state.teamMembers.has(where.teamId_userId.userId)
          ? { team: { organizationId: '00000000-0000-0000-0000-0000000000f0' } }
          : null,
    },
    user: {
      findUnique: async ({ where }: { where: { id: string } }) => ({
        active: state.active.has(where.id),
      }),
    },
  },
}));

const require = createRequire(import.meta.url);
const WebSocket = require('ws');
const Y = require('yjs');
const { HocuspocusProvider, HocuspocusProviderWebsocket } = require('@hocuspocus/provider');

import { server } from './server';

const PORT = 18235;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function connect(docName: string, userId: string) {
  const doc = new Y.Doc() as import('yjs').Doc;
  const ws = new HocuspocusProviderWebsocket({
    url: `ws://127.0.0.1:${PORT}`,
    WebSocketPolyfill: WebSocket,
  });
  const provider = new HocuspocusProvider({
    document: doc,
    name: docName,
    token: userId,
    websocketProvider: ws,
  });
  provider.attach();
  let failed = false;
  provider.on('authenticationFailed', () => {
    failed = true;
  });
  const synced = new Promise<void>(res => provider.on('synced', () => res()));
  return {
    authFailed: () => failed,
    close: () => {
      provider.destroy();
      ws.destroy();
    },
    doc,
    synced,
  };
}

/** Edit, then force the debounced store to run and let it settle. */
async function editAndFlush(c: ReturnType<typeof connect>, text: string) {
  c.doc.getText('t').insert(0, text);
  await sleep(300); // let the update reach the server
  server.hocuspocus.flushPendingStores();
  await sleep(500);
}

describe('yjs store-time access revalidation', () => {
  beforeAll(async () => {
    await server.listen(PORT);
  });
  afterAll(async () => {
    await server.destroy();
  });
  beforeEach(async () => {
    state.writes.length = 0;
    state.active = new Set(['member', 'guest', 'outsider']);
    state.teamMembers = new Set(['member', 'guest']);
    state.roles = { guest: 'guest', member: 'member' };
    state.issue = { assigneeId: null, creatorId: 'member' };
    // Let the previous test's rooms unload.
    await sleep(200);
  });

  it('control: an entitled member edit IS persisted', async () => {
    const m = connect(`document:${DOC_ID}`, 'member');
    await m.synced;
    await editAndFlush(m, 'hello');
    expect(state.writes).toContain('document');
    m.close();
  });

  it('does not persist an edit from a member removed from the team after connecting', async () => {
    const m = connect(`document:${DOC_ID}`, 'member');
    await m.synced;
    state.teamMembers.delete('member'); // removed from the private team
    await editAndFlush(m, 'late edit');
    expect(state.writes).toEqual([]);
    m.close();
  });

  it('does not persist an edit from a user deactivated after connecting', async () => {
    const m = connect(`document:${DOC_ID}`, 'member');
    await m.synced;
    state.active.delete('member');
    await editAndFlush(m, 'late edit');
    expect(state.writes).toEqual([]);
    m.close();
  });

  it('never persists a guest edit on a team document (read-only connection)', async () => {
    const g = connect(`document:${DOC_ID}`, 'guest');
    await g.synced;
    await editAndFlush(g, 'guest edit');
    expect(state.writes).toEqual([]);
    g.close();
  });

  it('does not persist an issue edit once a guest loses creator/assignee access', async () => {
    state.issue = { assigneeId: null, creatorId: 'guest' }; // their own issue: allowed in
    const g = connect(`issue:${ISSUE_ID}`, 'guest');
    await g.synced;
    state.issue = { assigneeId: null, creatorId: 'member' }; // reassigned away
    await editAndFlush(g, 'late edit');
    expect(state.writes).toEqual([]);
    g.close();
  });

  it('rejects a non-member of the private team at connect, so nothing is persisted', async () => {
    const o = connect(`document:${DOC_ID}`, 'outsider');
    await sleep(800);
    expect(o.authFailed()).toBe(true);
    o.doc.getText('t').insert(0, 'x');
    await editAndFlush(o, 'x');
    expect(state.writes).toEqual([]);
    o.close();
  });
});
