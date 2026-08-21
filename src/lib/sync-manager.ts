import { COMMIT_WATERMARK_LAG_MS, DELTA_PAGE_SIZE, MAX_PLAUSIBLE_XACT_ID } from '@/lib/sync-config';
import { normalizeIssueRow } from '@/stores/issue-store';
import type { RootStore } from '@/stores/root-store';
import type { IssueSyncRow } from './db';
import { db } from './db';
import {
  CACHED_COLLECTIONS,
  COLLECTIONS_STAMP_KEY,
  stampCoversRequiredCollections,
} from './db-collections';
import { createClientLogger } from './logger';
import type { SerializedSyncAction, WsClient } from './ws-client';

const log = createClientLogger('SyncManager');

/**
 * Cursor for delta-sync is a `(xactId, id)` tuple encoded as
 * `<xactId>-<id>`. Using id alone races when transactions commit out of
 * order — a slow-committing earlier-id row would be permanently skipped if
 * we just kept `max(id)`. `xactId` is the writing transaction's Postgres
 * xid8; the server fences delta reads on it so the tuple never advances past
 * a still-in-flight transaction. See `src/server/services/sync.service.ts`.
 */
function compareCursor(a: string, b: string): number {
  const [aXact, aId] = splitCursor(a);
  const [bXact, bId] = splitCursor(b);
  if (aXact < bXact) {
    return -1;
  }
  if (aXact > bXact) {
    return 1;
  }
  if (aId < bId) {
    return -1;
  }
  if (aId > bId) {
    return 1;
  }
  return 0;
}

function splitCursor(c: string): [bigint, bigint] {
  // Legacy `<id>` is treated as `(0, id)` so a re-read after upgrade
  // pulls in any rows the new encoding cares about.
  const dash = c.indexOf('-');
  if (dash === -1) {
    try {
      return [BigInt(0), BigInt(c)];
    } catch {
      return [BigInt(0), BigInt(0)];
    }
  }
  try {
    const xact = BigInt(c.slice(0, dash));
    // A first component above the plausible-xid ceiling is a stale
    // `<committedAtMicros>-<id>` cursor from before the xact_id migration;
    // collapse it to the zero cursor so a real incoming action's small xactId
    // overtakes it (and the persisted cursor heals) instead of the stale huge
    // value pinning `max()` forever. See MAX_PLAUSIBLE_XACT_ID.
    if (xact >= MAX_PLAUSIBLE_XACT_ID) {
      return [BigInt(0), BigInt(0)];
    }
    return [xact, BigInt(c.slice(dash + 1))];
  } catch {
    return [BigInt(0), BigInt(0)];
  }
}

function actionCursor(action: SerializedSyncAction): string {
  // xactId is the server-assigned xid8 (decimal string); pair it with id to
  // form the `(xactId, id)` cursor the server-side encoder produces.
  return `${action.xactId}-${action.id}`;
}

// Upper bound on delta pages consumed per deltaSync call. Server returns
// `DELTA_PAGE_SIZE` rows/page, so this covers a 1M-row backlog — far more
// than any realistic offline gap. A finite loop prevents a malformed server
// response (always returning hasMore=true) from spinning forever.
const MAX_DELTA_PAGES = 1_000_000 / DELTA_PAGE_SIZE;

/**
 * SyncManager orchestrates the full sync lifecycle:
 *
 * 1. App loads → check IndexedDB for cached data
 * 2. If no cache → Full Bootstrap → store in IndexedDB + MobX
 * 3. If cache exists → load into MobX → Delta sync from lastSyncId
 * 4. Open WebSocket → subscribe to org channel
 * 5. On WebSocket message → apply SyncActions to MobX + IndexedDB
 * 6. On disconnect → reconnect → Delta sync to catch up
 */
/**
 * The Dexie tables the uniform sync path writes to. Named once so the registry
 * below and the deferred delete/upsert buckets cannot drift apart.
 */
type DexieCacheTable =
  | 'customFieldDefinitions'
  | 'customViews'
  | 'cycles'
  | 'documents'
  | 'favorites'
  | 'initiativeProjects'
  | 'initiatives'
  | 'issueLabels'
  | 'issueRelations'
  | 'issueTemplates'
  | 'organizationMembers'
  | 'projectMilestones'
  | 'projectUpdates'
  | 'projects'
  | 'teams'
  | 'users'
  | 'workflowStates';

/**
 * Models the server emits that this client deliberately does not cache. Those
 * surfaces fetch over GraphQL on mount, so dropping the action costs only a live
 * update, not correctness.
 *
 * Exported because it is half of a contract `sync-manager.models.test.ts`
 * enforces: every model the server can emit must be handled here, handled as a
 * bespoke `case`, or listed below. A model that is none of those is the failure
 * this list exists to make loud — `Organization` was emitted and silently
 * dropped for months because nothing said out loud that it was missing.
 */
export const UNCACHED_MODELS = [
  'Comment',
  'CommentReaction',
  'File',
  'InitiativeUpdate',
  // Configuration. There is no settings store and no Dexie table: `/admin/config`
  // and the workspace settings pages read resolved values over GraphQL, and the
  // action's payload is `{scope, scopeId}` — a hint that something changed, not
  // the values themselves, which are per-caller anyway (the same key resolves
  // differently for a different team or user). The action exists because every
  // mutation emits one; a client that wants live config would refetch on it.
  'Setting',
  'TeamMembership',
] as const;

/**
 * The models whose handling is entirely uniform: hand the action to a store,
 * then mirror it into one Dexie table. Seventeen `case` arms repeated those
 * twelve lines verbatim, and the failure mode was silent — pair a model with the
 * wrong table, or forget one entirely, and rows vanish from the offline cache
 * with nothing failing — see `UNCACHED_MODELS` above for how that has already
 * played out once.
 *
 * Module-level and store-parameterised rather than built per call, so the table
 * is importable: `sync-manager.models.test.ts` reads `CACHED_MODELS` directly
 * instead of regex-scanning this file, which is both stronger (no pattern can
 * miss an entry) and one less thing coupled to how this file is indented.
 *
 * The models that genuinely are not uniform — `Organization` (no store, strips
 * two settings blobs), `Issue` (two payload shapes, secondary index) and
 * `Notification` (scoped to one recipient) — keep their own `case` arm, listed
 * in `BESPOKE_MODELS`.
 *
 * `cache` is generic so each entry keeps its store method's own parameter type,
 * and the method is bound so `.bind` carries the MobX `action` wrapper with it.
 * Note what this does *not* buy: the payload cast is unchecked, exactly as the
 * old per-arm `data as Parameters<…>[2]` was, and nothing at the type level ties
 * a key to the store it names. `sync-manager.models.test.ts` catches that, not
 * the compiler.
 */
function cache<T>(
  resolve: (stores: RootStore) => (action: string, id: string, data: T | null) => void,
  table: DexieCacheTable,
): CachedModel {
  return {
    apply: (stores, action, id, data) => resolve(stores)(action, id, data as T | null),
    table,
  };
}

export const CACHED_MODELS = new Map<string, CachedModel>(
  Object.entries({
    CustomFieldDefinition: cache(
      s => s.customFieldStore.applyDefinitionSyncAction.bind(s.customFieldStore),
      'customFieldDefinitions',
    ),
    CustomView: cache(
      s => s.customViewStore.applySyncAction.bind(s.customViewStore),
      'customViews',
    ),
    Cycle: cache(s => s.cycleStore.applySyncAction.bind(s.cycleStore), 'cycles'),
    Document: cache(s => s.documentStore.applySyncAction.bind(s.documentStore), 'documents'),
    Favorite: cache(s => s.favoriteStore.applySyncAction.bind(s.favoriteStore), 'favorites'),
    Initiative: cache(
      s => s.initiativeStore.applySyncAction.bind(s.initiativeStore),
      'initiatives',
    ),
    InitiativeProject: cache(
      s => s.initiativeStore.applyInitiativeProjectSyncAction.bind(s.initiativeStore),
      'initiativeProjects',
    ),
    IssueLabel: cache(s => s.labelStore.applySyncAction.bind(s.labelStore), 'issueLabels'),
    IssueRelation: cache(
      s => s.issueRelationStore.applySyncAction.bind(s.issueRelationStore),
      'issueRelations',
    ),
    IssueTemplate: cache(
      s => s.issueTemplateStore.applySyncAction.bind(s.issueTemplateStore),
      'issueTemplates',
    ),
    OrganizationMember: cache(
      s => s.organizationMemberStore.applySyncAction.bind(s.organizationMemberStore),
      'organizationMembers',
    ),
    Project: cache(s => s.projectStore.applySyncAction.bind(s.projectStore), 'projects'),
    ProjectMilestone: cache(
      s => s.projectStore.applyMilestoneSyncAction.bind(s.projectStore),
      'projectMilestones',
    ),
    ProjectUpdate: cache(
      s => s.projectStore.applyUpdateSyncAction.bind(s.projectStore),
      'projectUpdates',
    ),
    Team: cache(s => s.teamStore.applySyncAction.bind(s.teamStore), 'teams'),
    User: cache(s => s.userStore.applySyncAction.bind(s.userStore), 'users'),
    WorkflowState: cache(
      s => s.workflowStateStore.applySyncAction.bind(s.workflowStateStore),
      'workflowStates',
    ),
  }),
);

/** Models handled by their own `case` arm because their handling is not uniform. */
export const BESPOKE_MODELS = ['Organization', 'Issue', 'Notification'] as const;

/** A model whose SyncAction handling is "apply to a store, mirror into a table". */
interface CachedModel {
  apply: (stores: RootStore, action: string, id: string, data: unknown) => void;
  table: DexieCacheTable;
}

export class SyncManager {
  private wsClient: WsClient;
  private stores: RootStore;
  private wsUnsubscribers: Array<() => void> = [];
  private isBootstrapping = false;
  private isDeltaSyncing = false;
  private stopped = false;
  // Single coalesced timer for post-drain catch-up — multiple drains in
  // rapid succession (e.g. a hydrate replay batch) collapse to one
  // delta-sync after the last one settles.
  private drainedRetryTimer: ReturnType<typeof setTimeout> | null = null;
  // Follow-up delta scheduled ~800ms after every successful (re)connect and
  // after fullBootstrap — catches actions that land in the gap between the
  // server's commit-order fence (a row is delta-visible only once its
  // transaction settles) and Redis pub/sub's no-replay semantics (a message
  // published before this client's SUBSCRIBE completed is gone forever).
  // Coalesced the same way as drainedRetryTimer.
  private connectFollowUpTimer: ReturnType<typeof setTimeout> | null = null;
  // The 'resync' WS message's jittered retry timer — tracked so stop() can
  // cancel it instead of leaving a stray deltaSync() to fire after teardown.
  private resyncJitterTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(stores: RootStore, wsClient: WsClient) {
    this.stores = stores;
    this.wsClient = wsClient;
  }

  async start(orgId: string) {
    const { syncStore } = this.stores;
    syncStore.setStatus('bootstrapping');

    // If the cache was last populated for a different org (token refresh
    // hit a new orgId, or the user signed into a different account on the
    // same browser) wipe IndexedDB before loading. Without this, the prior
    // org's rows hydrate into MobX for the duration of the deltaSync round-
    // trip — visible flicker plus a real cross-org leak window.
    await this.invalidateCacheIfOrgChanged(orgId);

    // Load cached data from IndexedDB into MobX stores
    const hasCachedData = await this.loadFromIndexedDB();

    if (hasCachedData) {
      // We have cached data — apply delta sync to catch up
      syncStore.setStatus('syncing');
      await this.deltaSync();
    } else {
      // No cache — do a full bootstrap
      await this.fullBootstrap();
      // Bootstrap's own lastSyncId comes from the server at request time, so
      // it has exactly the same commit-order-fence/pub-sub-no-replay gap as a
      // post-connect delta (see scheduleFollowUpDelta docstring) — schedule
      // the same catch-up.
      this.scheduleFollowUpDelta();
    }

    // Don't open a WS connection if stop() was called while we were bootstrapping
    if (this.stopped) {
      return;
    }

    // Connect WebSocket for real-time updates. WsClient self-fetches a
    // fresh ws-ticket on each (re)connect so we don't pass one here.
    this.setupWebSocket();

    // Offline / online detection
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);

    // When a TransactionQueue mutation drains successfully, the server
    // creates a SyncAction and publishes it to Redis. If our WS connection
    // happened to be mid-handshake at that moment, the broadcast went to
    // an empty subscriber set and pub/sub doesn't replay. Schedule a
    // delta-sync once the mutation's transaction has settled to catch it up —
    // this is the post-reload-hydrate case the offline tests exercise.
    window.addEventListener('bilinear:transaction-drained', this.handleTransactionDrained);
  }

  stop() {
    this.stopped = true;
    if (this.drainedRetryTimer) {
      clearTimeout(this.drainedRetryTimer);
      this.drainedRetryTimer = null;
    }
    if (this.connectFollowUpTimer) {
      clearTimeout(this.connectFollowUpTimer);
      this.connectFollowUpTimer = null;
    }
    if (this.resyncJitterTimer) {
      clearTimeout(this.resyncJitterTimer);
      this.resyncJitterTimer = null;
    }
    window.removeEventListener('bilinear:transaction-drained', this.handleTransactionDrained);
    for (const unsub of this.wsUnsubscribers) {
      unsub();
    }
    this.wsUnsubscribers = [];
    this.wsClient.disconnect();
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
  }

  // ─── Private methods ────────────────────────────────────────────────────────

  private async invalidateCacheIfOrgChanged(activeOrgId: string): Promise<void> {
    if (!activeOrgId) {
      return;
    }
    const cached = await db.syncMetadata.get('activeOrgId');
    const cachedOrgId = typeof cached?.value === 'string' ? cached.value : null;

    if (cachedOrgId && cachedOrgId !== activeOrgId) {
      // Cross-org cache — wipe every table. Bootstrap will refill from
      // the server using the new orgId.
      await db.transaction('rw', db.tables, async () => {
        for (const table of db.tables) {
          await table.clear();
        }
      });
    }

    // Write the new orgId outside the wipe transaction on purpose. The
    // wipe table list includes syncMetadata; folding the put into the same
    // txn would race the clear() and lose the value.
    if (cachedOrgId !== activeOrgId) {
      await db.syncMetadata.put({ key: 'activeOrgId', value: activeOrgId });
    }
  }

  private async loadFromIndexedDB(): Promise<boolean> {
    const [
      orgs,
      teams,
      users,
      states,
      labels,
      issues,
      cycles,
      documents,
      projects,
      projectMilestones,
      projectUpdates,
      customViews,
      notifications,
      issueRelations,
      issueTemplates,
      customFieldDefinitions,
      customFieldValues,
      initiatives,
      initiativeProjects,
      favorites,
      organizationMembers,
      meta,
      collectionsStamp,
    ] = await Promise.all([
      db.organizations.toArray(),
      db.teams.toArray(),
      db.users.toArray(),
      db.workflowStates.toArray(),
      db.issueLabels.toArray(),
      db.issues.toArray(),
      db.cycles.toArray(),
      db.documents.toArray(),
      db.projects.toArray(),
      db.projectMilestones.toArray(),
      db.projectUpdates.toArray(),
      db.customViews.toArray(),
      db.notifications.toArray(),
      db.issueRelations.toArray(),
      db.issueTemplates.toArray(),
      db.customFieldDefinitions.toArray(),
      db.customFieldValues.toArray(),
      db.initiatives.toArray(),
      db.initiativeProjects.toArray(),
      db.favorites.toArray(),
      db.organizationMembers.toArray(),
      db.syncMetadata.get('lastSyncId'),
      db.syncMetadata.get(COLLECTIONS_STAMP_KEY),
    ]);

    if (!meta?.value) {
      return false;
    }

    // A cursor alone doesn't mean the cache is *complete*. A Dexie upgrade
    // that adds a collection creates that table empty and carries the rest
    // over, so `lastSyncId` survives and this would report a usable cache —
    // after which `start` takes the delta path, which only carries rows that
    // changed. The new collection would never backfill.
    //
    // The stamp is written by `fullBootstrap` in the same transaction as the
    // rows it describes, so it can only claim what was actually persisted.
    // Refusing here costs one bootstrap; accepting a cache with a hole in it
    // renders an empty state for as long as nothing happens to touch those
    // rows. Caches written before the stamp existed have no stamp and are
    // correctly refused once.
    if (!stampCoversRequiredCollections(collectionsStamp?.value)) {
      return false;
    }

    const {
      teamStore,
      userStore,
      workflowStateStore,
      labelStore,
      issueStore,
      cycleStore,
      documentStore,
      favoriteStore,
      initiativeStore,
      projectStore,
      customViewStore,
      customFieldStore,
      notificationStore,
      issueRelationStore,
      issueTemplateStore,
      organizationMemberStore,
      syncStore,
    } = this.stores;

    if (orgs.length > 0 || teams.length > 0) {
      if (orgs[0]?.name) {
        syncStore.setOrganizationName(orgs[0].name);
      }
      teamStore.upsertMany(teams);
      userStore.upsertMany(users);
      organizationMemberStore.upsertMany(organizationMembers);
      workflowStateStore.upsertMany(states);
      labelStore.upsertMany(labels);
      issueStore.upsertMany(issues);
      cycleStore.upsertMany(cycles);
      documentStore.upsertMany(documents);
      favoriteStore.upsertMany(favorites as Parameters<typeof favoriteStore.upsertMany>[0]);
      initiativeStore.upsertMany(initiatives);
      initiativeStore.upsertProjectLinks(initiativeProjects);
      projectStore.upsertMany(projects);
      projectStore.upsertMilestones(projectMilestones);
      projectStore.upsertUpdates(projectUpdates);
      customViewStore.upsertMany(customViews);
      notificationStore.upsertMany(notifications);
      issueRelationStore.upsertMany(issueRelations);
      issueTemplateStore.upsertMany(issueTemplates);
      customFieldStore.upsertDefinitions(customFieldDefinitions);
      customFieldStore.upsertValues(customFieldValues);
      syncStore.setLastSyncId(String(meta.value));
      return true;
    }
    return false;
  }

  private async fullBootstrap() {
    if (this.isBootstrapping) {
      return;
    }
    this.isBootstrapping = true;

    const {
      syncStore,
      teamStore,
      userStore,
      workflowStateStore,
      labelStore,
      issueStore,
      cycleStore,
      documentStore,
      initiativeStore,
      projectStore,
      customViewStore,
      customFieldStore,
      notificationStore,
      issueRelationStore,
      issueTemplateStore,
      organizationMemberStore,
    } = this.stores;

    try {
      const res = await fetch('/api/sync/bootstrap', {
        credentials: 'include',
      });

      if (!res.ok) {
        syncStore.setStatus('error');
        syncStore.setError('Bootstrap failed');
        this.isBootstrapping = false;
        return;
      }

      const text = await res.text();
      const lines = text.split('\n').filter(Boolean);

      const batches = {
        customFieldDefinitions: [] as object[],
        customFieldValues: [] as object[],
        customViews: [] as object[],
        cycles: [] as object[],
        documents: [] as object[],
        initiativeProjects: [] as object[],
        initiatives: [] as object[],
        issueLabels: [] as object[],
        issueRelations: [] as object[],
        issues: [] as object[],
        issueTemplates: [] as object[],
        notifications: [] as object[],
        organizationMembers: [] as object[],
        organizations: [] as object[],
        projectMilestones: [] as object[],
        projects: [] as object[],
        projectUpdates: [] as object[],
        teams: [] as object[],
        users: [] as object[],
        workflowStates: [] as object[],
      };

      let lastSyncId = '0';

      for (const line of lines) {
        const eqIdx = line.indexOf('=');
        if (eqIdx === -1) {
          continue;
        }
        const modelName = line.slice(0, eqIdx);
        const jsonStr = line.slice(eqIdx + 1);
        const data = JSON.parse(jsonStr);

        if (modelName === '_metadata_') {
          lastSyncId = (data as { lastSyncId: string }).lastSyncId;
          continue;
        }

        const key = `${modelName.charAt(0).toLowerCase() + modelName.slice(1)}s`;
        if (key in batches) {
          (batches as Record<string, object[]>)[key].push(data);
        }
      }

      // Clear and write in a single Dexie transaction to prevent data loss if
      // a write fails — and on the apply chain, so a live WS action cannot
      // interleave with (or be erased by) this authoritative load.
      await this.runExclusive(async () => {
        await db.transaction(
          'rw',
          [
            db.organizations,
            db.organizationMembers,
            db.teams,
            db.users,
            db.workflowStates,
            db.issueLabels,
            db.issues,
            db.cycles,
            db.documents,
            db.initiatives,
            db.initiativeProjects,
            db.projects,
            db.projectMilestones,
            db.projectUpdates,
            db.customViews,
            db.notifications,
            db.issueRelations,
            db.issueTemplates,
            db.customFieldDefinitions,
            db.customFieldValues,
            db.syncMetadata,
          ],
          async () => {
            await Promise.all([
              db.organizations.clear(),
              db.organizationMembers.clear(),
              db.teams.clear(),
              db.users.clear(),
              db.workflowStates.clear(),
              db.issueLabels.clear(),
              db.issues.clear(),
              db.cycles.clear(),
              db.documents.clear(),
              db.initiatives.clear(),
              db.initiativeProjects.clear(),
              db.projects.clear(),
              db.projectMilestones.clear(),
              db.projectUpdates.clear(),
              db.customViews.clear(),
              db.notifications.clear(),
              db.issueRelations.clear(),
              db.issueTemplates.clear(),
              db.customFieldDefinitions.clear(),
              db.customFieldValues.clear(),
            ]);
            await Promise.all([
              db.organizations.bulkPut(
                batches.organizations as Parameters<typeof db.organizations.bulkPut>[0],
              ),
              db.organizationMembers.bulkPut(
                batches.organizationMembers as Parameters<typeof db.organizationMembers.bulkPut>[0],
              ),
              db.teams.bulkPut(batches.teams as Parameters<typeof db.teams.bulkPut>[0]),
              db.users.bulkPut(batches.users as Parameters<typeof db.users.bulkPut>[0]),
              db.workflowStates.bulkPut(
                batches.workflowStates as Parameters<typeof db.workflowStates.bulkPut>[0],
              ),
              db.issueLabels.bulkPut(
                batches.issueLabels as Parameters<typeof db.issueLabels.bulkPut>[0],
              ),
              db.issues.bulkPut(batches.issues as Parameters<typeof db.issues.bulkPut>[0]),
              db.cycles.bulkPut(batches.cycles as Parameters<typeof db.cycles.bulkPut>[0]),
              db.documents.bulkPut(batches.documents as Parameters<typeof db.documents.bulkPut>[0]),
              db.projects.bulkPut(batches.projects as Parameters<typeof db.projects.bulkPut>[0]),
              db.projectMilestones.bulkPut(
                batches.projectMilestones as Parameters<typeof db.projectMilestones.bulkPut>[0],
              ),
              db.projectUpdates.bulkPut(
                batches.projectUpdates as Parameters<typeof db.projectUpdates.bulkPut>[0],
              ),
              db.customViews.bulkPut(
                batches.customViews as Parameters<typeof db.customViews.bulkPut>[0],
              ),
              db.notifications.bulkPut(
                batches.notifications as Parameters<typeof db.notifications.bulkPut>[0],
              ),
              db.issueRelations.bulkPut(
                batches.issueRelations as Parameters<typeof db.issueRelations.bulkPut>[0],
              ),
              db.issueTemplates.bulkPut(
                batches.issueTemplates as Parameters<typeof db.issueTemplates.bulkPut>[0],
              ),
              db.customFieldDefinitions.bulkPut(
                batches.customFieldDefinitions as Parameters<
                  typeof db.customFieldDefinitions.bulkPut
                >[0],
              ),
              db.customFieldValues.bulkPut(
                batches.customFieldValues as Parameters<typeof db.customFieldValues.bulkPut>[0],
              ),
              db.initiatives.bulkPut(
                batches.initiatives as Parameters<typeof db.initiatives.bulkPut>[0],
              ),
              db.initiativeProjects.bulkPut(
                batches.initiativeProjects as Parameters<typeof db.initiativeProjects.bulkPut>[0],
              ),
              db.syncMetadata.put({ key: 'lastSyncId', value: lastSyncId }),
              // Stamped here, inside the same transaction as the rows above,
              // so it can never outlive a write that failed — the claim "this
              // cache holds these collections" commits or rolls back with the
              // rows that make it true.
              db.syncMetadata.put({
                key: COLLECTIONS_STAMP_KEY,
                value: [...CACHED_COLLECTIONS],
              }),
            ]);
          },
        );

        // Replace, don't merge. IndexedDB was just wiped and refilled above; the
        // MobX pools have to be too, or an entity deleted while this client was
        // offline lingers in memory until a page reload — which is exactly the
        // state a `staleCursor` re-bootstrap exists to repair. `replaceAll` on
        // the membership store below is the same rule, applied per-store.
        this.stores.clearEntityPools();

        // Populate MobX stores
        const firstOrg = batches.organizations[0] as { name?: string } | undefined;
        if (firstOrg?.name) {
          syncStore.setOrganizationName(firstOrg.name);
        }
        // `replaceAll`, not `upsertMany`: a bootstrap is an authoritative load,
        // and `fullBootstrap` is also the delta-failure fallback — it runs
        // *after* `loadFromIndexedDB` filled the pool from a warm cache.
        // Membership is hard-deleted, so a row the server omitted means the
        // person left; merging would keep them in the roster with a role
        // dropdown and a remove button the server answers with NOT_FOUND.
        organizationMemberStore.replaceAll(
          batches.organizationMembers as Parameters<typeof organizationMemberStore.replaceAll>[0],
        );
        teamStore.upsertMany(batches.teams as Parameters<typeof teamStore.upsertMany>[0]);
        userStore.upsertMany(batches.users as Parameters<typeof userStore.upsertMany>[0]);
        workflowStateStore.upsertMany(
          batches.workflowStates as Parameters<typeof workflowStateStore.upsertMany>[0],
        );
        labelStore.upsertMany(batches.issueLabels as Parameters<typeof labelStore.upsertMany>[0]);
        issueStore.upsertMany(batches.issues as Parameters<typeof issueStore.upsertMany>[0]);
        cycleStore.upsertMany(batches.cycles as Parameters<typeof cycleStore.upsertMany>[0]);
        documentStore.upsertMany(
          batches.documents as Parameters<typeof documentStore.upsertMany>[0],
        );
        projectStore.upsertMany(batches.projects as Parameters<typeof projectStore.upsertMany>[0]);
        projectStore.upsertMilestones(
          batches.projectMilestones as Parameters<typeof projectStore.upsertMilestones>[0],
        );
        projectStore.upsertUpdates(
          batches.projectUpdates as Parameters<typeof projectStore.upsertUpdates>[0],
        );
        customViewStore.upsertMany(
          batches.customViews as Parameters<typeof customViewStore.upsertMany>[0],
        );
        notificationStore.upsertMany(
          batches.notifications as Parameters<typeof notificationStore.upsertMany>[0],
        );
        issueRelationStore.upsertMany(
          batches.issueRelations as Parameters<typeof issueRelationStore.upsertMany>[0],
        );
        issueTemplateStore.upsertMany(
          batches.issueTemplates as Parameters<typeof issueTemplateStore.upsertMany>[0],
        );
        customFieldStore.upsertDefinitions(
          batches.customFieldDefinitions as Parameters<
            typeof customFieldStore.upsertDefinitions
          >[0],
        );
        customFieldStore.upsertValues(
          batches.customFieldValues as Parameters<typeof customFieldStore.upsertValues>[0],
        );
        initiativeStore.upsertMany(
          batches.initiatives as Parameters<typeof initiativeStore.upsertMany>[0],
        );
        initiativeStore.upsertProjectLinks(
          batches.initiativeProjects as Parameters<typeof initiativeStore.upsertProjectLinks>[0],
        );
        syncStore.setLastSyncId(lastSyncId);
      });
      syncStore.setStatus('connected');
    } catch (err) {
      log.error('Bootstrap error', err);
      syncStore.setStatus('error');
      syncStore.setError('Bootstrap failed');
    } finally {
      this.isBootstrapping = false;
    }
  }

  private async deltaSync() {
    if (this.isDeltaSyncing || this.stopped) {
      return;
    }
    this.isDeltaSyncing = true;

    const { syncStore } = this.stores;

    // Local pagination cursor, captured once and advanced only from each
    // page's OWN actions — never re-read from `syncStore.lastSyncId` inside
    // the loop. `applyActions()` is also invoked directly by live WS
    // messages (`setupWebSocket`'s onMessage handler) and mutates that same
    // shared cursor; a live action arriving mid-backlog could otherwise jump
    // the shared value to ~now, making the next page request
    // `?lastSyncId=<now>` and silently skip the remaining backlog. Paging
    // strictly off a local variable makes concurrent WS applies invisible to
    // (and unable to corrupt) this loop.
    let cursor = syncStore.lastSyncId;

    try {
      // Server caps each delta response; loop until hasMore=false so a
      // long-offline client catches up fully.
      for (let page = 0; page < MAX_DELTA_PAGES; page++) {
        if (this.stopped) {
          return;
        }
        const res = await fetch(`/api/sync/delta?lastSyncId=${encodeURIComponent(cursor)}`, {
          credentials: 'include',
        });

        if (!res.ok) {
          // Delta failed — fall back to full bootstrap
          this.isDeltaSyncing = false;
          await this.fullBootstrap();
          // Same catch-up the cold-start bootstrap schedules, and needed more
          // here: this path runs with the WebSocket already live, so an action
          // that applied while the snapshot was in flight is erased by the
          // authoritative write. `fullBootstrap` regresses `lastSyncId` to the
          // snapshot's cursor, so the follow-up re-delivers it.
          this.scheduleFollowUpDelta();
          return;
        }

        const body = (await res.json()) as {
          actions: SerializedSyncAction[];
          hasMore: boolean;
          staleCursor?: boolean;
        };
        // Our cursor predates the server's `sync_actions` retention window, so
        // the actions needed to catch up have been pruned. Continuing would
        // look like a successful sync while leaving the cache permanently
        // missing whatever was deleted — discard it and re-bootstrap instead.
        if (body.staleCursor) {
          log.warn('Delta cursor older than server retention window — re-bootstrapping');
          this.isDeltaSyncing = false;
          await this.fullBootstrap();
          return;
        }
        if (body.actions.length === 0) {
          break;
        }
        // Advance the LOCAL cursor from this page's own actions before
        // applying them (see rationale above) so a concurrent WS apply
        // can't affect what page we request next.
        for (const action of body.actions) {
          const actionC = actionCursor(action);
          if (compareCursor(actionC, cursor) > 0) {
            cursor = actionC;
          }
        }
        await this.applyActions(body.actions);
        if (!body.hasMore) {
          break;
        }
      }
      // Commit the shared cursor to the max of (its current value, which a
      // concurrent WS apply may have already advanced further, and what
      // this delta paged through) — never regress it, and never let a
      // partial/early-exit path above leave it behind what we actually
      // fetched.
      if (compareCursor(cursor, syncStore.lastSyncId) > 0) {
        syncStore.setLastSyncId(cursor);
      }
      syncStore.setStatus('connected');
    } catch (err) {
      log.error('Delta sync error', err);
      // Non-fatal — we'll catch up via WebSocket
      syncStore.setStatus('connected');
    } finally {
      this.isDeltaSyncing = false;
    }
  }

  /**
   * Serialize every apply — delta pages AND live WS messages — through a
   * single-slot promise chain. `applyActions` is invoked from both `deltaSync`
   * (line ~604) and the WS `onMessage` handler; without a lock a WS message
   * arriving while a delta is mid-`await` interleaves its MobX/Dexie writes and
   * its `lastSyncId` advance with the delta's. Both calls read the same stale
   * `syncStore.lastSyncId`, then race the shared Dexie transaction — the slower
   * one can persist a LOWER `lastSyncId` (forcing the next delta to re-request
   * already-applied actions) and, with overlapping action sets, overwrite a
   * newer row with an older snapshot. Writes are idempotent so this was benign
   * at small scale; the lock makes it correct at any delta-page size / WS rate.
   */
  private applyLock: Promise<void> = Promise.resolve();

  /**
   * Queue `task` on the apply chain. Also used by `fullBootstrap`, whose
   * write phase is an *authoritative* load and so must not interleave with an
   * incremental one either: it clears Dexie and (for the roster, the one
   * hard-deleted model) clears the MobX pool, so a live action landing
   * mid-bootstrap would be dropped rather than merely overwritten. Reached
   * from `deltaSync`'s failure fallback while the WebSocket is live, which is
   * exactly when that overlap is possible.
   */
  private runExclusive<T>(task: () => Promise<T>): Promise<T> {
    const run = this.applyLock.then(task);
    // Keep the chain alive if one task throws — a rejected lock would wedge
    // every subsequent apply. Callers still see the real rejection via `run`.
    this.applyLock = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  private applyActions(actions: SerializedSyncAction[]): Promise<void> {
    if (actions.length === 0) {
      return Promise.resolve();
    }
    return this.runExclusive(() => this.doApplyActions(actions));
  }

  private async doApplyActions(actions: SerializedSyncAction[]) {
    // Only the stores the bespoke `case` arms below reach for directly; the
    // uniform models resolve theirs through CACHED_MODELS.
    const { issueStore, customFieldStore, notificationStore, userStore, syncStore } = this.stores;

    let maxId = syncStore.lastSyncId;

    // Collect Dexie writes so we can flush them in one transaction at the end
    const dexieUpserts: {
      teams: object[];
      users: object[];
      workflowStates: object[];
      issueLabels: object[];
      issues: object[];
      cycles: object[];
      documents: object[];
      initiatives: object[];
      initiativeProjects: object[];
      organizations: object[];
      projects: object[];
      projectMilestones: object[];
      projectUpdates: object[];
      customViews: object[];
      notifications: object[];
      issueRelations: object[];
      issueTemplates: object[];
      customFieldDefinitions: object[];
      customFieldValues: object[];
      favorites: object[];
      organizationMembers: object[];
    } = {
      customFieldDefinitions: [],
      customFieldValues: [],
      customViews: [],
      cycles: [],
      documents: [],
      favorites: [],
      initiativeProjects: [],
      initiatives: [],
      issueLabels: [],
      issueRelations: [],
      issues: [],
      issueTemplates: [],
      notifications: [],
      organizationMembers: [],
      organizations: [],
      projectMilestones: [],
      projects: [],
      projectUpdates: [],
      teams: [],
      users: [],
      workflowStates: [],
    };
    const dexieDeletes: {
      table:
        | 'organizations'
        | 'teams'
        | 'users'
        | 'workflowStates'
        | 'issueLabels'
        | 'issues'
        | 'cycles'
        | 'documents'
        | 'initiatives'
        | 'initiativeProjects'
        | 'projects'
        | 'projectMilestones'
        | 'projectUpdates'
        | 'customViews'
        | 'notifications'
        | 'issueRelations'
        | 'issueTemplates'
        | 'customFieldDefinitions'
        | 'favorites'
        | 'organizationMembers';
      id: string;
    }[] = [];
    /**
     * Issue-scoped value replacements: key is the issueId, value is the list
     * of new rows. We defer Dexie writes so we can delete stale rows and
     * insert fresh ones atomically in the closing transaction.
     */
    const customFieldValueReplaces = new Map<string, object[]>();

    for (const action of actions) {
      const { action: act, modelName, modelId, data } = action;

      switch (modelName) {
        // There is no organization store — the org row is only read back out of
        // Dexie at bootstrap (for the workspace name). Persist it so an admin's
        // settings change survives to the next load; without this case the
        // action was emitted by the server and silently dropped here.
        case 'Organization':
          if (act === 'D') {
            dexieDeletes.push({ id: modelId, table: 'organizations' });
          } else if (data) {
            dexieUpserts.organizations.push(data as Record<string, unknown>);
          }
          break;
        case 'Issue': {
          // Two different payload shapes ride the 'Issue' stream:
          //
          //   1. A full issue row (every column, always including `identifier`).
          //   2. `{ customFieldValues: [...] }` and nothing else — emitted by
          //      `issueCustomFieldValuesSet`, with no `id` and no issue columns.
          //
          // Shape 2 must NOT reach the issue store or `db.issues`. The store's
          // apply is a whole-object replace, so it would erase every column of
          // the issue; and `db.issues` has an inbound `id` keyPath, so a row
          // with no `id` fails the put and aborts the entire Dexie transaction
          // — which is also where the lastSyncId cursor is persisted, so the
          // poisoned action would replay and re-abort on every reload.
          //
          // Discriminate on the payload carrying anything *beyond* the value
          // set, rather than on a specific column, so a future partial issue
          // payload still applies.
          const payload = data as Record<string, unknown> | null;
          const isIssueRow =
            act === 'D' ||
            (payload !== null && Object.keys(payload).some(k => k !== 'customFieldValues'));
          if (isIssueRow) {
            // Normalize ONCE and hand the same object to both sinks. Computing
            // it separately for the store and for Dexie made "they agree" a
            // prose claim rather than something the code enforces.
            const normalized =
              act === 'D'
                ? null
                : normalizeIssueRow(data as IssueSyncRow, issueStore.pool.get(modelId)?.labelIds);
            issueStore.applySyncAction(act, modelId, normalized);
            if (act === 'D') {
              dexieDeletes.push({ id: modelId, table: 'issues' });
            } else if (normalized?.id) {
              // `db.issues` has an inbound `id` keyPath, and a put with no `id`
              // throws inside the shared transaction, rolling back every other
              // entity in the batch.
              dexieUpserts.issues.push(normalized);
            }
          }
          if (payload !== null && 'customFieldValues' in payload) {
            customFieldStore.applyValueSyncAction(
              act,
              modelId,
              data as Parameters<typeof customFieldStore.applyValueSyncAction>[2],
            );
            const values = payload.customFieldValues as object[] | undefined;
            if (values) {
              customFieldValueReplaces.set(modelId, values);
            }
          }
          break;
        }
        case 'Notification': {
          // SyncActions broadcast org-wide, but a notification belongs to one
          // recipient. `NotificationStore` documents its pool as "already
          // scoped to the current user" — and `markAllRead()` relies on that —
          // so another user's mark-read broadcast must not land in it.
          const recipientId = (data as { userId?: string } | null)?.userId;
          if (act !== 'D' && recipientId && recipientId !== userStore.currentUserId) {
            break;
          }
          notificationStore.applySyncAction(
            act,
            modelId,
            data as Parameters<typeof notificationStore.applySyncAction>[2],
          );
          if (act === 'D') {
            dexieDeletes.push({ id: modelId, table: 'notifications' });
          } else if (data) {
            dexieUpserts.notifications.push(data);
          }
          break;
        }
        // Everything else is either uniform (CACHED_MODELS) or deliberately not
        // cached (UNCACHED_MODELS). The warn is why a missing model is loud
        // rather than silent — see UNCACHED_MODELS for the story behind that.
        default: {
          // A `Map`, not an object literal: a bare index on a literal walks
          // `Object.prototype`, so a model named `constructor` or `toString`
          // resolves to an inherited function, slips past this guard, and throws
          // out of the whole batch — losing every other model's update and
          // stalling the cursor.
          const cached = CACHED_MODELS.get(modelName);
          if (!cached) {
            log.warn('Unhandled SyncAction model — not cached', undefined, {
              modelName: action.modelName,
            });
            break;
          }
          cached.apply(this.stores, act, modelId, data);
          if (act === 'D') {
            dexieDeletes.push({ id: modelId, table: cached.table });
          } else if (data) {
            dexieUpserts[cached.table].push(data);
          }
          break;
        }
      }

      // Update max sync cursor — `(xactId, id)` tuple comparison.
      // Using id alone would skip an earlier-id-later-committed row.
      const incoming = actionCursor(action);
      if (compareCursor(incoming, maxId) > 0) {
        maxId = incoming;
      }
    }

    syncStore.setLastSyncId(maxId);

    // Persist to IndexedDB so real-time updates survive a page refresh
    await db.transaction(
      'rw',
      [
        db.teams,
        db.users,
        db.workflowStates,
        db.issueLabels,
        db.issues,
        db.cycles,
        db.documents,
        db.initiatives,
        db.initiativeProjects,
        db.projects,
        db.projectMilestones,
        db.projectUpdates,
        db.customViews,
        db.notifications,
        db.issueRelations,
        db.issueTemplates,
        db.customFieldDefinitions,
        db.customFieldValues,
        db.favorites,
        db.organizations,
        db.organizationMembers,
        db.syncMetadata,
      ],
      async () => {
        await Promise.all([
          dexieUpserts.teams.length > 0 &&
            db.teams.bulkPut(dexieUpserts.teams as Parameters<typeof db.teams.bulkPut>[0]),
          dexieUpserts.organizations.length > 0 &&
            db.organizations.bulkPut(
              dexieUpserts.organizations as Parameters<typeof db.organizations.bulkPut>[0],
            ),
          dexieUpserts.organizationMembers.length > 0 &&
            db.organizationMembers.bulkPut(
              dexieUpserts.organizationMembers as Parameters<
                typeof db.organizationMembers.bulkPut
              >[0],
            ),
          dexieUpserts.users.length > 0 &&
            db.users.bulkPut(dexieUpserts.users as Parameters<typeof db.users.bulkPut>[0]),
          dexieUpserts.workflowStates.length > 0 &&
            db.workflowStates.bulkPut(
              dexieUpserts.workflowStates as Parameters<typeof db.workflowStates.bulkPut>[0],
            ),
          dexieUpserts.issueLabels.length > 0 &&
            db.issueLabels.bulkPut(
              dexieUpserts.issueLabels as Parameters<typeof db.issueLabels.bulkPut>[0],
            ),
          dexieUpserts.issues.length > 0 &&
            db.issues.bulkPut(dexieUpserts.issues as Parameters<typeof db.issues.bulkPut>[0]),
          dexieUpserts.cycles.length > 0 &&
            db.cycles.bulkPut(dexieUpserts.cycles as Parameters<typeof db.cycles.bulkPut>[0]),
          dexieUpserts.documents.length > 0 &&
            db.documents.bulkPut(
              dexieUpserts.documents as Parameters<typeof db.documents.bulkPut>[0],
            ),
          dexieUpserts.projects.length > 0 &&
            db.projects.bulkPut(dexieUpserts.projects as Parameters<typeof db.projects.bulkPut>[0]),
          dexieUpserts.projectMilestones.length > 0 &&
            db.projectMilestones.bulkPut(
              dexieUpserts.projectMilestones as Parameters<typeof db.projectMilestones.bulkPut>[0],
            ),
          dexieUpserts.projectUpdates.length > 0 &&
            db.projectUpdates.bulkPut(
              dexieUpserts.projectUpdates as Parameters<typeof db.projectUpdates.bulkPut>[0],
            ),
          dexieUpserts.customViews.length > 0 &&
            db.customViews.bulkPut(
              dexieUpserts.customViews as Parameters<typeof db.customViews.bulkPut>[0],
            ),
          dexieUpserts.notifications.length > 0 &&
            db.notifications.bulkPut(
              dexieUpserts.notifications as Parameters<typeof db.notifications.bulkPut>[0],
            ),
          dexieUpserts.issueRelations.length > 0 &&
            db.issueRelations.bulkPut(
              dexieUpserts.issueRelations as Parameters<typeof db.issueRelations.bulkPut>[0],
            ),
          dexieUpserts.issueTemplates.length > 0 &&
            db.issueTemplates.bulkPut(
              dexieUpserts.issueTemplates as Parameters<typeof db.issueTemplates.bulkPut>[0],
            ),
          dexieUpserts.customFieldDefinitions.length > 0 &&
            db.customFieldDefinitions.bulkPut(
              dexieUpserts.customFieldDefinitions as Parameters<
                typeof db.customFieldDefinitions.bulkPut
              >[0],
            ),
          dexieUpserts.initiatives.length > 0 &&
            db.initiatives.bulkPut(
              dexieUpserts.initiatives as Parameters<typeof db.initiatives.bulkPut>[0],
            ),
          dexieUpserts.initiativeProjects.length > 0 &&
            db.initiativeProjects.bulkPut(
              dexieUpserts.initiativeProjects as Parameters<
                typeof db.initiativeProjects.bulkPut
              >[0],
            ),
          dexieUpserts.favorites.length > 0 &&
            db.favorites.bulkPut(
              dexieUpserts.favorites as Parameters<typeof db.favorites.bulkPut>[0],
            ),
          db.syncMetadata.put({ key: 'lastSyncId', value: maxId }),
        ]);
        await Promise.all(dexieDeletes.map(({ table, id }) => db[table].delete(id)));
        // Replace each affected issue's value rows atomically: delete the
        // stale set by issueId index, then bulkPut the fresh list.
        for (const [issueId, values] of customFieldValueReplaces) {
          await db.customFieldValues.where('issueId').equals(issueId).delete();
          if (values.length > 0) {
            await db.customFieldValues.bulkPut(
              values as Parameters<typeof db.customFieldValues.bulkPut>[0],
            );
          }
        }
        // When a definition is deleted, Postgres cascade-deletes its values;
        // mirror that on the client so stale rows don't linger.
        for (const del of dexieDeletes) {
          if (del.table === 'customFieldDefinitions') {
            await db.customFieldValues.where('definitionId').equals(del.id).delete();
          }
        }
      },
    );
  }

  private setupWebSocket() {
    const unsub1 = this.wsClient.onMessage(async msg => {
      if (msg.cmd === 'sync') {
        await this.applyActions(msg.sync);
      } else if (msg.cmd === 'resync') {
        // Server lost messages (typically after a Redis subscriber blip).
        // Re-run delta from our cursor to pull whatever the WS dropped.
        // Stagger the request with a small jitter so a fleet-wide hint
        // doesn't trigger a thundering herd against /api/sync/delta.
        const jitterMs = Math.floor(Math.random() * 500);
        if (this.resyncJitterTimer) {
          clearTimeout(this.resyncJitterTimer);
        }
        this.resyncJitterTimer = setTimeout(() => {
          this.resyncJitterTimer = null;
          if (this.stopped) {
            return;
          }
          void this.deltaSync();
        }, jitterMs);
      }
    });

    const unsub2 = this.wsClient.onStatusChange(connected => {
      const { syncStore } = this.stores;
      syncStore.setWsConnected(connected);
      if (connected) {
        syncStore.setStatus('connected');
        // Catch up on any missed actions
        this.deltaSync();
        this.scheduleFollowUpDelta();
      } else {
        syncStore.setStatus('offline');
      }
    });

    this.wsUnsubscribers.push(unsub1, unsub2);
    this.wsClient.connect();
  }

  /**
   * Schedule one follow-up delta-sync ~800ms after a (re)connect or a
   * fullBootstrap. Redis pub/sub only delivers messages published after
   * this client's SUBSCRIBE completes — it has no replay — and the delta
   * endpoint's commit-order fence excludes a row until its transaction has
   * settled. An action committing right around connect time can therefore be
   * neither delta'd (its tx hadn't settled at the delta read) nor pushed
   * (published before the subscribe), leaving it invisible until the next
   * reconnect. Re-running delta a short debounce later (once the tx has
   * settled) closes that gap. `COMMIT_WATERMARK_LAG_MS` is reused purely as
   * that client-side settle delay — the server no longer applies a wall-clock
   * watermark. Coalesced like `handleTransactionDrained` so rapid reconnects
   * collapse to a single follow-up.
   */
  private scheduleFollowUpDelta = () => {
    if (this.stopped) {
      return;
    }
    if (this.connectFollowUpTimer) {
      clearTimeout(this.connectFollowUpTimer);
    }
    this.connectFollowUpTimer = setTimeout(() => {
      this.connectFollowUpTimer = null;
      if (this.stopped) {
        return;
      }
      void this.deltaSync();
    }, COMMIT_WATERMARK_LAG_MS + 300);
  };

  /**
   * Coalesce drain notifications into a single delta-sync a short settle delay
   * (`COMMIT_WATERMARK_LAG_MS`) after the last drain. By the time this fires
   * the drained mutation's transaction has settled, so the next delta's
   * commit-order fence includes its SyncAction even if the WS broadcast was
   * lost in a reconnect handshake gap.
   */
  private handleTransactionDrained = () => {
    if (this.stopped) {
      return;
    }
    if (this.drainedRetryTimer) {
      clearTimeout(this.drainedRetryTimer);
    }
    this.drainedRetryTimer = setTimeout(() => {
      this.drainedRetryTimer = null;
      void this.deltaSync();
    }, COMMIT_WATERMARK_LAG_MS + 100);
  };

  private handleOnline = () => {
    const { syncStore } = this.stores;
    syncStore.setStatus('syncing');
    this.deltaSync();
  };

  private handleOffline = () => {
    this.stores.syncStore.setStatus('offline');
  };
}
