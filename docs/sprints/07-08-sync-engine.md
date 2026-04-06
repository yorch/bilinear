# Sprint 7-8: Real-Time Sync Engine
## Issue Tracker — Linear Rebuild

**Phase:** 1 (Foundation)  
**Weeks:** 13-16  
**Goal:** Local-first architecture with optimistic updates and real-time sync

**Prerequisites:** Sprint 5-6 (issue CRUD, list view — sync wraps around existing mutations)

---

## 1. Overview

The sync engine is the most critical technical component. It enables sub-50ms interaction times by reading from a local IndexedDB cache, applying mutations optimistically, and syncing with the server in the background. This sprint transforms the existing request-response GraphQL flow into a local-first architecture.

**Ref:** `docs/ARCHITECTURE.md` section 3 (Sync Engine Architecture) — this is the primary reference.

---

## 2. Patterns to Establish

### 2.1 Local-First Data Flow Pattern

All reads come from local state. All writes are optimistic-first:

```
User Action → MobX Store (instant UI) → IndexedDB (persist) → GraphQL Mutation (async)
                                                                      ↓
Server confirms → SyncAction created → Redis PubSub → WebSocket → all clients
```

### 2.2 MobX Store Pattern

Every entity store follows this pattern:

```typescript
class IssueStore {
  pool: Map<string, Issue> = new Map();  // Object pool indexed by ID

  // Computed getters with filters
  get activeIssues(): Issue[] { ... }
  getByTeam(teamId: string): Issue[] { ... }

  // Sync integration
  applySyncAction(action: SyncAction): void {
    switch (action.action) {
      case 'I': this.pool.set(action.modelId, action.data); break;
      case 'U': Object.assign(this.pool.get(action.modelId), action.data); break;
      case 'D': this.pool.delete(action.modelId); break;
    }
  }

  // Optimistic write
  async save(issue: Partial<Issue> & { id: string }): Promise<void> {
    // 1. Apply locally (instant)
    this.applySyncAction({ action: 'U', modelName: 'Issue', modelId: issue.id, data: issue });
    // 2. Persist to IndexedDB
    await this.db.issues.put(issue);
    // 3. Queue GraphQL mutation
    this.syncManager.enqueue({ mutation: 'issueUpdate', variables: { id: issue.id, input: issue } });
  }
}
```

### 2.3 Transaction Queue Pattern

Failed mutations retry with backoff. Permanently failed mutations roll back local state:

```typescript
class TransactionQueue {
  queue: Transaction[] = [];

  async process(): Promise<void> {
    for (const tx of this.queue) {
      try {
        const result = await this.executeMutation(tx);
        tx.resolve(result);
      } catch (error) {
        if (isPermanentError(error)) {
          this.rollback(tx);
        } else {
          tx.retryCount++;
          // Re-enqueue with backoff
        }
      }
    }
  }
}
```

### 2.4 SyncAction Schema

Every mutation on the server generates a SyncAction (the atomic unit of sync):

```typescript
interface SyncAction {
  id: number;          // Monotonically increasing BIGSERIAL
  action: 'I' | 'U' | 'D' | 'A';  // Insert, Update, Delete, Archive
  modelName: string;   // "Issue", "Team", "User", etc.
  modelId: string;     // UUID of affected entity
  data: object | null; // Full or partial entity (null for deletes)
}
```

---

## 3. Database Schema (Prisma)

**Ref:** `docs/DATABASE_SCHEMA.md` section 3 (Sync Actions)

### Models to add to `prisma/schema.prisma`

```prisma
model SyncAction {
  id        BigInt   @id @default(autoincrement())
  action    String   @db.VarChar(1) // I, U, D, A
  modelName String   @map("model_name") @db.VarChar(50)
  modelId   String   @map("model_id") @db.Uuid
  data      Json?

  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz

  @@index([createdAt])
  @@map("sync_actions")
}
```

---

## 4. Server-Side Implementation

### 4.1 SyncAction Generation

Wrap every mutation to generate a SyncAction after the database write:

```typescript
// src/server/services/sync.service.ts
export class SyncService {
  async createSyncAction(
    action: 'I' | 'U' | 'D' | 'A',
    modelName: string,
    modelId: string,
    data: object | null,
  ): Promise<SyncAction> {
    const syncAction = await this.prisma.syncAction.create({
      data: { action, modelName, modelId, data },
    });
    // Broadcast via Redis PubSub
    await this.redis.publish(`sync:${orgId}`, JSON.stringify(syncAction));
    return syncAction;
  }
}
```

### 4.2 Modify All Existing Mutations

Every mutation resolver from Sprints 1-6 must now:
1. Perform the database write (existing)
2. Create a SyncAction (new)
3. Return `lastSyncId` in the payload (new)

```typescript
// Example: issueCreate resolver modification
issueCreate: async (_parent, { input }, ctx) => {
  const issue = await ctx.services.issue.create(ctx.orgId, input);
  const syncAction = await ctx.services.sync.createSyncAction('I', 'Issue', issue.id, issue);
  return { success: true, issue, lastSyncId: Number(syncAction.id) };
},
```

### 4.3 REST Sync Endpoints

**Ref:** `docs/API_DESIGN.md` section 10 (Sync Endpoints)

```
GET /api/sync/bootstrap?type=full&onlyModels=Issue,Team,User,...
GET /api/sync/bootstrap?type=partial&onlyModels=Comment,IssueHistory
GET /api/sync/delta?lastSyncId=X&toSyncId=Y
```

Implement as Next.js API routes:

| File | Endpoint | Purpose |
|------|----------|---------|
| `src/app/api/sync/bootstrap/route.ts` | `GET /api/sync/bootstrap` | Full/partial bootstrap |
| `src/app/api/sync/delta/route.ts` | `GET /api/sync/delta` | Delta sync catch-up |

**Bootstrap response format:** line-delimited `ModelName=<JSON>\n`, ending with `_metadata_={"lastSyncId": N}`

**Model load strategies:**

| Strategy | When Loaded | Models |
|----------|-------------|--------|
| `instant` | Full bootstrap | Organization, Team, User, Issue, WorkflowState, IssueLabel |
| `partial` | Partial bootstrap | Comment, IssueHistory (future sprints) |
| `lazy` | On demand | Attachment content (future sprints) |

### 4.4 WebSocket Server

**Ref:** `docs/API_DESIGN.md` section 11 (WebSocket Protocol)

```
Connection: ws://localhost:3000/ws
  Headers: Authorization: Bearer <token>

Server → Client:
  { "cmd": "sync", "sync": [SyncAction, ...], "lastSyncId": N }
  { "cmd": "ping" }

Client → Server:
  { "cmd": "pong" }
  { "cmd": "subscribe", "channels": ["org:<orgId>"] }
```

Implementation approach: use the `ws` library with a custom Next.js server or a separate WebSocket process that subscribes to Redis PubSub.

### 4.5 Redis PubSub Broadcast

```
Channel: sync:<orgId>
Payload: JSON SyncAction
```

Each WebSocket server instance subscribes to the org channel. When a SyncAction is published, it broadcasts to all connected clients in that org.

---

## 5. Client-Side Implementation

### 5.1 IndexedDB Schema (Dexie.js)

```typescript
// src/lib/db.ts
import Dexie, { type Table } from 'dexie';

export class AppDatabase extends Dexie {
  organizations!: Table<Organization>;
  users!: Table<User>;
  teams!: Table<Team>;
  issues!: Table<Issue>;
  workflowStates!: Table<WorkflowState>;
  issueLabels!: Table<IssueLabel>;
  syncMetadata!: Table<{ key: string; value: unknown }>;

  constructor() {
    super('issue-tracker');
    this.version(1).stores({
      organizations: 'id',
      users: 'id, email',
      teams: 'id, organizationId',
      issues: 'id, teamId, stateId, assigneeId, identifier',
      workflowStates: 'id, teamId',
      issueLabels: 'id, organizationId, teamId',
      syncMetadata: 'key',
    });
  }
}
```

### 5.2 MobX Root Store

**Ref:** `docs/ARCHITECTURE.md` section 4.2 (State Management)

```typescript
// src/stores/root-store.ts
class RootStore {
  authStore: AuthStore;
  syncStore: SyncStore;
  workspaceStore: WorkspaceStore;
  issueStore: IssueStore;
  teamStore: TeamStore;
  userStore: UserStore;
  labelStore: LabelStore;
  uiStore: UIStore;
}
```

### 5.3 SyncManager

Orchestrates the full sync lifecycle:

```
1. App loads → check IndexedDB for cached data
2. If no cache → Full Bootstrap → store in IndexedDB + MobX
3. If cache exists → load into MobX → Delta sync from lastSyncId
4. Open WebSocket → subscribe to org channel
5. On WebSocket message → apply SyncActions to MobX + IndexedDB
6. On disconnect → reconnect → Delta sync to catch up
7. On mutation → optimistic update → queue GraphQL → handle response
```

### 5.4 Offline Detection

```typescript
// Monitor connection state
window.addEventListener('online', () => syncManager.reconnect());
window.addEventListener('offline', () => syncManager.pause());
```

---

## 6. Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `prisma/schema.prisma` | **Modify** | Add SyncAction model |
| `src/server/services/sync.service.ts` | **Create** | SyncAction creation + Redis broadcast |
| `src/app/api/sync/bootstrap/route.ts` | **Create** | Bootstrap endpoint |
| `src/app/api/sync/delta/route.ts` | **Create** | Delta sync endpoint |
| `src/server/ws/index.ts` | **Create** | WebSocket server setup |
| `src/server/ws/connection-manager.ts` | **Create** | Track connected clients per org |
| `src/server/ws/sync-broadcaster.ts` | **Create** | Redis PubSub → WebSocket broadcast |
| `src/server/graphql/resolvers/*.ts` | **Modify** | Add SyncAction creation to all mutations |
| `src/lib/db.ts` | **Create** | Dexie.js IndexedDB schema |
| `src/stores/root-store.ts` | **Create** | MobX root store |
| `src/stores/sync-store.ts` | **Create** | Sync state (lastSyncId, connection status) |
| `src/stores/issue-store.ts` | **Create** | Issue object pool + computed getters |
| `src/stores/team-store.ts` | **Create** | Team object pool |
| `src/stores/user-store.ts` | **Create** | User object pool |
| `src/stores/label-store.ts` | **Create** | Label object pool |
| `src/stores/ui-store.ts` | **Create** | UI state (sidebar, selection, active view) |
| `src/lib/sync-manager.ts` | **Create** | Sync lifecycle orchestrator |
| `src/lib/transaction-queue.ts` | **Create** | Optimistic mutation queue |
| `src/lib/ws-client.ts` | **Create** | WebSocket client with reconnection |
| `src/providers/store-provider.tsx` | **Create** | React context for MobX stores |
| `src/providers/sync-provider.tsx` | **Create** | Bootstrap + sync lifecycle provider |
| `src/components/issues/issue-list-view.tsx` | **Modify** | Read from MobX store instead of direct GraphQL |

---

## 7. Dependencies to Install

```bash
# Backend
yarn add ws                        # WebSocket server

# Frontend
yarn add dexie                     # IndexedDB wrapper
yarn add mobx mobx-react-lite      # State management

# Dev
yarn add -D @types/ws
```

---

## 8. Acceptance Criteria

- [ ] Every mutation creates a SyncAction with monotonically increasing ID
- [ ] `GET /api/sync/bootstrap?type=full` returns all Organization, Team, User, Issue, WorkflowState, IssueLabel data
- [ ] Bootstrap response is line-delimited format ending with `_metadata_`
- [ ] `GET /api/sync/delta?lastSyncId=X` returns SyncActions since X
- [ ] WebSocket connection authenticates via JWT
- [ ] Creating an issue on Client A appears on Client B within 1 second (via WebSocket)
- [ ] Updating an issue status on Client A reflects on Client B in real-time
- [ ] App loads cached data from IndexedDB on refresh (no loading spinner for cached data)
- [ ] After refresh, delta sync catches up with any changes made while offline
- [ ] Optimistic updates: clicking a status change reflects immediately in the UI before server confirms
- [ ] Failed mutations roll back the optimistic update
- [ ] Going offline → making changes → going online syncs all queued mutations
- [ ] Two browser tabs stay in sync via the WebSocket connection
- [ ] MobX stores correctly apply Insert, Update, Delete, Archive SyncActions

---

## 9. Cross-References

| Topic | Document | Section |
|-------|----------|---------|
| Sync engine design | `docs/ARCHITECTURE.md` | 3. Sync Engine Architecture |
| SyncAction schema | `docs/ARCHITECTURE.md` | 3.3 SyncAction Schema |
| Bootstrap process | `docs/ARCHITECTURE.md` | 3.4 Bootstrap Process |
| Model load strategies | `docs/ARCHITECTURE.md` | 3.5 Model Load Strategies |
| Conflict resolution | `docs/ARCHITECTURE.md` | 3.6 Conflict Resolution |
| MobX state management | `docs/ARCHITECTURE.md` | 4.2 State Management |
| Sync broadcast pipeline | `docs/ARCHITECTURE.md` | 5.3 Sync Broadcast Pipeline |
| Sync REST endpoints | `docs/API_DESIGN.md` | 10. Sync Endpoints |
| WebSocket protocol | `docs/API_DESIGN.md` | 11. WebSocket Protocol |
| Mutation payloads (lastSyncId) | `docs/API_DESIGN.md` | 9. Mutation Payloads |
