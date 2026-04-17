# Sprint 13-14: Projects
## Issue Tracker — Linear Rebuild

**Phase:** 2 (Essential Features)  
**Weeks:** 13-14  
**Goal:** Project list, detail views, milestones, and project updates with real-time sync
**Status:** ✅ Shipped — historical spec; current state lives in `docs/IMPLEMENTATION_PLAN.md` and the source tree.

**Prerequisites:** Sprints 1-12 (full Phase 1 foundation — sync engine, MobX stores, WebSocket)

---

## 1. Overview

This sprint adds the Projects feature: multi-team cross-cutting work containers that hold issues, milestones, and status updates. The DB schema and GraphQL backend were established before this sprint began. Sprint 13-14 focus is the **client-side sync integration** and the **Project Updates UI** (the most complex new UI piece).

---

## 2. Patterns Established

### 2.1 Adding a New Entity to the Sync Pipeline

See `docs/PATTERNS.md` §32 for the full checklist. The five-file touch pattern is:

1. `src/lib/db.ts` — `DB*` interface + Dexie version bump
2. MobX store — pool + upsert + getter + `applySyncAction`
3. `src/app/api/sync/bootstrap/route.ts` — emit entity lines in stream
4. `src/lib/sync-manager.ts` — `loadFromIndexedDB`, `fullBootstrap`, `applyActions`
5. `src/server/services/sync.service.ts` — add Prisma query to `getBootstrapData`

`ProjectUpdate` is the canonical reference implementation for this pattern.

### 2.2 Shared Form Fields Component

When a create form and an edit form share identical fields, extract a shared `*FormFields` component that accepts controlled values and change callbacks:

```typescript
interface UpdateFormFieldsProps {
  body: string;
  health: string;
  onBodyChange: (value: string) => void;
  onHealthChange: (value: string) => void;
  placeholder?: string;
}

function UpdateFormFields({ body, health, onBodyChange, onHealthChange, placeholder }) {
  return (
    <>
      {/* health picker */}
      <textarea value={body} onChange={e => onBodyChange(e.target.value)} placeholder={placeholder} />
    </>
  );
}
```

The create and edit forms render this component and supply their own submit buttons and headers. This avoids duplicating the fields while keeping distinct form chrome (different border colors, headers, button labels).

### 2.3 Mutual Exclusion for Multiple Inline Forms

When a list can have both a "create" form and per-item "edit" forms, use two state variables and open helpers that enforce mutual exclusion:

```typescript
const [creating, setCreating] = useState(false);
const [editingId, setEditingId] = useState<string | null>(null);

const openCreate = () => { setEditingId(null); setCreating(true); };
const openEdit = (id: string) => { setCreating(false); setEditingId(id); };
```

This prevents two forms from being open at the same time. The "Add" button is hidden when `!creating && !editingId` so the user cannot open a second form.

### 2.4 ISO Date Sort with localeCompare

For `createdAt` fields stored as ISO 8601 strings, use `localeCompare` instead of `new Date().getTime()`:

```typescript
// ✅ Efficient — no Date allocation, correct lexicographic order
.sort((a, b) => b.createdAt.localeCompare(a.createdAt))

// ❌ Unnecessary — allocates two Date objects per comparison
.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
```

ISO 8601 strings in UTC (`YYYY-MM-DDTHH:MM:SSZ`) sort lexicographically in the same order as chronological order.

---

## 3. Feature Implementation

### 3.1 DB Client Types (`src/lib/db.ts`)

New interface added to the client type definitions:

```typescript
export interface DBProjectUpdate {
  id: string;
  projectId: string;
  userId: string;
  body: string;
  health?: string | null;
  editedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}
```

Dexie bumped to version 3 with `projectUpdates: 'id, projectId, userId'`.

### 3.2 ProjectStore Extensions (`src/stores/project-store.ts`)

`ProjectStore` already held `pool` (projects) and `milestonePool` (milestones). Added `updatePool`:

- `upsertUpdates(updates: DBProjectUpdate[])` — bulk insert/overwrite
- `getUpdates(projectId: string): DBProjectUpdate[]` — filter by project, sort newest-first via `localeCompare`
- `applyUpdateSyncAction(actionType, id, data)` — routes I/U/A/D to the pool

Corresponding unit tests in `src/stores/project-store.test.ts` cover all three methods (14 tests).

### 3.3 Bootstrap Integration

**`src/server/services/sync.service.ts`** — `getBootstrapData` fetches up to 500 project updates (ordered by `createdAt DESC`). A TODO comment documents the 500-record hard cap for future pagination.

**`src/app/api/sync/bootstrap/route.ts`** — emits `ProjectUpdate=<json>` lines in the streaming response.

**`src/lib/sync-manager.ts`** — three touch points:
- `loadFromIndexedDB`: reads `db.projectUpdates.toArray()` and calls `projectStore.upsertUpdates()`
- `fullBootstrap`: clears and bulk-puts `projectUpdates` inside the Dexie transaction, then calls `projectStore.upsertUpdates()`
- `applyActions`: handles `case 'ProjectUpdate'` in the switch, routing to `projectStore.applyUpdateSyncAction()`

### 3.4 Project Updates UI (`src/components/projects/project-updates-section.tsx`)

A self-contained section component rendered inside `ProjectDetailView`. Structure:

- **`ProjectUpdatesSection`** (observer) — reads `projectStore.getUpdates(projectId)`, manages `creating`/`editingId` state
- **`UpdateFormFields`** — shared controlled component for health picker + body textarea
- **`CreateUpdateForm`** — calls `projectUpdateCreate` mutation; closes on success
- **`EditUpdateForm`** — calls `projectUpdateUpdate` mutation; indigo border to indicate active edit
- **`DeleteUpdateButton`** — two-step confirmation (Delete? → Yes/No) with `deleting` state
- **`formatRelativeDate`** — local helper (just now / Nh ago / yesterday / Nd ago / Nw ago / MMM D)

#### Avatar color handling

User avatars fall back to a Tailwind token rather than hardcoded hex:

```tsx
<span
  className={cn(
    'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold text-white',
    !author?.avatarBgColor && 'bg-indigo-500',  // Tailwind fallback
  )}
  style={author?.avatarBgColor ? { backgroundColor: author.avatarBgColor } : undefined}
>
  {author?.initials ?? '?'}
</span>
```

This pattern (Tailwind class for the default, inline style for the dynamic value) is established in `project-list-view.tsx` and `settings/page.tsx`.

### 3.5 Integration in Detail View (`src/components/projects/project-detail-view.tsx`)

```typescript
const viewerId = userStore.currentUserId ?? '';
// ...
<ProjectUpdatesSection projectId={project.id} viewerId={viewerId} />
```

`viewerId` is passed so the component can show edit/delete controls only to the update author.

---

## 4. GraphQL Mutations

All three project update mutations were already implemented server-side:

| Mutation               | Input type                 | Returns                      |
| ---------------------- | -------------------------- | ---------------------------- |
| `projectUpdateCreate`  | `ProjectUpdateCreateInput` | `{ success }`                |
| `projectUpdateUpdate`  | `ProjectUpdateUpdateInput` | `{ success }`                |
| `projectUpdateDelete`  | `id: ID!`                  | `{ success }`                |

Each creates a SyncAction (`I`, `U`, `D` respectively) which is published to Redis and broadcast via WebSocket to all connected org clients.

---

## 5. Testing

**Unit tests** (`src/stores/project-store.test.ts`): 14 pure Vitest tests covering:
- `upsertUpdates` — insert, overwrite, empty array
- `getUpdates` — project filter, newest-first sort, empty pool/project, multi-user
- `applyUpdateSyncAction` — all four action types, non-existent delete is safe, null data guard

---

## 6. Deferred Items

| Item                                      | Notes                                                     |
| ----------------------------------------- | --------------------------------------------------------- |
| Progress tracking (completed / scope)     | Requires counting linked issues per project               |
| Assign issues to projects (Shift+P)       | Keyboard shortcut + mutation                              |
| Project milestones UI                     | Backend + store done; detail panel UI deferred            |
| Bootstrap pagination for project updates  | TODO comment in `sync.service.ts`; needed at ~500+ updates |
