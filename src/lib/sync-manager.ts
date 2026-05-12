import type { RootStore } from '@/stores/root-store';
import { db } from './db';
import type { SerializedSyncAction, WsClient } from './ws-client';

/**
 * Cursor for delta-sync is a `(committedAt, id)` tuple encoded as
 * `<committedAtMicros>-<id>`. Using id alone races when transactions
 * commit out of order — a slow-committing earlier-id row would be
 * permanently skipped if we just kept `max(id)`. See
 * `src/server/services/sync.service.ts` for the server-side encoding.
 */
function compareCursor(a: string, b: string): number {
  const [aMicros, aId] = splitCursor(a);
  const [bMicros, bId] = splitCursor(b);
  if (aMicros < bMicros) {
    return -1;
  }
  if (aMicros > bMicros) {
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
    return [BigInt(c.slice(0, dash)), BigInt(c.slice(dash + 1))];
  } catch {
    return [BigInt(0), BigInt(0)];
  }
}

function actionCursor(action: SerializedSyncAction): string {
  // committedAt is a Date ISO string from the server; convert to
  // microseconds-since-epoch to match the server-side encoder.
  const micros = BigInt(new Date(action.committedAt).getTime()) * BigInt(1000);
  return `${micros.toString()}-${action.id}`;
}

// Upper bound on delta pages consumed per deltaSync call. Server returns
// 5,000 rows/page, so this covers a 1M-row backlog — far more than any
// realistic offline gap. A finite loop prevents a malformed server
// response (always returning hasMore=true) from spinning forever.
const MAX_DELTA_PAGES = 200;

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
    // delta-sync past the server's watermark to catch it up — this is
    // the post-reload-hydrate case the offline tests exercise.
    window.addEventListener('bilinear:transaction-drained', this.handleTransactionDrained);
  }

  stop() {
    this.stopped = true;
    if (this.drainedRetryTimer) {
      clearTimeout(this.drainedRetryTimer);
      this.drainedRetryTimer = null;
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
      meta,
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
      db.syncMetadata.get('lastSyncId'),
    ]);

    if (!meta?.value) {
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
      initiativeStore,
      projectStore,
      customViewStore,
      customFieldStore,
      notificationStore,
      issueRelationStore,
      issueTemplateStore,
      syncStore,
    } = this.stores;

    if (orgs.length > 0 || teams.length > 0) {
      if (orgs[0]?.name) {
        syncStore.setOrganizationName(orgs[0].name);
      }
      teamStore.upsertMany(teams);
      userStore.upsertMany(users);
      workflowStateStore.upsertMany(states);
      labelStore.upsertMany(labels);
      issueStore.upsertMany(issues);
      cycleStore.upsertMany(cycles);
      documentStore.upsertMany(documents);
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

      // Clear and write in a single Dexie transaction to prevent data loss if a write fails
      await db.transaction(
        'rw',
        [
          db.organizations,
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
          ]);
        },
      );

      // Populate MobX stores
      const firstOrg = batches.organizations[0] as { name?: string } | undefined;
      if (firstOrg?.name) {
        syncStore.setOrganizationName(firstOrg.name);
      }
      teamStore.upsertMany(batches.teams as Parameters<typeof teamStore.upsertMany>[0]);
      userStore.upsertMany(batches.users as Parameters<typeof userStore.upsertMany>[0]);
      workflowStateStore.upsertMany(
        batches.workflowStates as Parameters<typeof workflowStateStore.upsertMany>[0],
      );
      labelStore.upsertMany(batches.issueLabels as Parameters<typeof labelStore.upsertMany>[0]);
      issueStore.upsertMany(batches.issues as Parameters<typeof issueStore.upsertMany>[0]);
      cycleStore.upsertMany(batches.cycles as Parameters<typeof cycleStore.upsertMany>[0]);
      documentStore.upsertMany(batches.documents as Parameters<typeof documentStore.upsertMany>[0]);
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
        batches.customFieldDefinitions as Parameters<typeof customFieldStore.upsertDefinitions>[0],
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
      syncStore.setStatus('connected');
    } catch (err) {
      console.error('[SyncManager] Bootstrap error:', err);
      syncStore.setStatus('error');
      syncStore.setError('Bootstrap failed');
    } finally {
      this.isBootstrapping = false;
    }
  }

  private async deltaSync() {
    if (this.isDeltaSyncing) {
      return;
    }
    this.isDeltaSyncing = true;

    const { syncStore } = this.stores;

    try {
      // Server caps each delta response; loop until hasMore=false so a
      // long-offline client catches up fully. `syncStore.lastSyncId`
      // advances inside applyActions, so each iteration sends the fresh
      // cursor.
      for (let page = 0; page < MAX_DELTA_PAGES; page++) {
        const cursor = syncStore.lastSyncId;
        const res = await fetch(`/api/sync/delta?lastSyncId=${encodeURIComponent(cursor)}`, {
          credentials: 'include',
        });

        if (!res.ok) {
          // Delta failed — fall back to full bootstrap
          this.isDeltaSyncing = false;
          await this.fullBootstrap();
          return;
        }

        const body = (await res.json()) as {
          actions: SerializedSyncAction[];
          hasMore: boolean;
        };
        if (body.actions.length === 0) {
          break;
        }
        await this.applyActions(body.actions);
        if (!body.hasMore) {
          break;
        }
      }
      syncStore.setStatus('connected');
    } catch (err) {
      console.error('[SyncManager] Delta sync error:', err);
      // Non-fatal — we'll catch up via WebSocket
      syncStore.setStatus('connected');
    } finally {
      this.isDeltaSyncing = false;
    }
  }

  private async applyActions(actions: SerializedSyncAction[]) {
    if (actions.length === 0) {
      return;
    }

    const {
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
      syncStore,
    } = this.stores;

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
      issueActivities: object[];
    } = {
      customFieldDefinitions: [],
      customFieldValues: [],
      customViews: [],
      cycles: [],
      documents: [],
      initiativeProjects: [],
      initiatives: [],
      issueActivities: [],
      issueLabels: [],
      issueRelations: [],
      issues: [],
      issueTemplates: [],
      notifications: [],
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
        | 'issueActivities';
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
        case 'Team':
          teamStore.applySyncAction(
            act,
            modelId,
            data as Parameters<typeof teamStore.applySyncAction>[2],
          );
          if (act === 'D') {
            dexieDeletes.push({ id: modelId, table: 'teams' });
          } else if (data) {
            dexieUpserts.teams.push(data);
          }
          break;
        case 'User':
          userStore.applySyncAction(
            act,
            modelId,
            data as Parameters<typeof userStore.applySyncAction>[2],
          );
          if (act === 'D') {
            dexieDeletes.push({ id: modelId, table: 'users' });
          } else if (data) {
            dexieUpserts.users.push(data);
          }
          break;
        case 'WorkflowState':
          workflowStateStore.applySyncAction(
            act,
            modelId,
            data as Parameters<typeof workflowStateStore.applySyncAction>[2],
          );
          if (act === 'D') {
            dexieDeletes.push({ id: modelId, table: 'workflowStates' });
          } else if (data) {
            dexieUpserts.workflowStates.push(data);
          }
          break;
        case 'IssueLabel':
          labelStore.applySyncAction(
            act,
            modelId,
            data as Parameters<typeof labelStore.applySyncAction>[2],
          );
          if (act === 'D') {
            dexieDeletes.push({ id: modelId, table: 'issueLabels' });
          } else if (data) {
            dexieUpserts.issueLabels.push(data);
          }
          break;
        case 'Issue':
          issueStore.applySyncAction(
            act,
            modelId,
            data as Parameters<typeof issueStore.applySyncAction>[2],
          );
          if (act === 'D') {
            dexieDeletes.push({ id: modelId, table: 'issues' });
          } else if (data) {
            dexieUpserts.issues.push(data);
          }
          // Custom field values ride the 'Issue' stream with shape
          // { customFieldValues: [...] }. When present, replace the issue's
          // entire value set on both the MobX store and Dexie.
          if (data && typeof data === 'object' && 'customFieldValues' in data) {
            customFieldStore.applyValueSyncAction(
              act,
              modelId,
              data as Parameters<typeof customFieldStore.applyValueSyncAction>[2],
            );
            const values = (data as { customFieldValues?: object[] }).customFieldValues;
            if (values) {
              customFieldValueReplaces.set(modelId, values);
            }
          }
          break;
        case 'CustomFieldDefinition':
          customFieldStore.applyDefinitionSyncAction(
            act,
            modelId,
            data as Parameters<typeof customFieldStore.applyDefinitionSyncAction>[2],
          );
          if (act === 'D') {
            dexieDeletes.push({ id: modelId, table: 'customFieldDefinitions' });
          } else if (data) {
            dexieUpserts.customFieldDefinitions.push(data);
          }
          break;
        case 'Cycle':
          cycleStore.applySyncAction(
            act,
            modelId,
            data as Parameters<typeof cycleStore.applySyncAction>[2],
          );
          if (act === 'D') {
            dexieDeletes.push({ id: modelId, table: 'cycles' });
          } else if (data) {
            dexieUpserts.cycles.push(data);
          }
          break;
        case 'Project':
          projectStore.applySyncAction(
            act,
            modelId,
            data as Parameters<typeof projectStore.applySyncAction>[2],
          );
          if (act === 'D') {
            dexieDeletes.push({ id: modelId, table: 'projects' });
          } else if (data) {
            dexieUpserts.projects.push(data);
          }
          break;
        case 'ProjectMilestone':
          projectStore.applyMilestoneSyncAction(
            act,
            modelId,
            data as Parameters<typeof projectStore.applyMilestoneSyncAction>[2],
          );
          if (act === 'D') {
            dexieDeletes.push({ id: modelId, table: 'projectMilestones' });
          } else if (data) {
            dexieUpserts.projectMilestones.push(data);
          }
          break;
        case 'ProjectUpdate':
          projectStore.applyUpdateSyncAction(
            act,
            modelId,
            data as Parameters<typeof projectStore.applyUpdateSyncAction>[2],
          );
          if (act === 'D') {
            dexieDeletes.push({ id: modelId, table: 'projectUpdates' });
          } else if (data) {
            dexieUpserts.projectUpdates.push(data);
          }
          break;
        case 'CustomView':
          customViewStore.applySyncAction(
            act,
            modelId,
            data as Parameters<typeof customViewStore.applySyncAction>[2],
          );
          if (act === 'D') {
            dexieDeletes.push({ id: modelId, table: 'customViews' });
          } else if (data) {
            dexieUpserts.customViews.push(data);
          }
          break;
        case 'Notification':
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
        case 'IssueRelation':
          issueRelationStore.applySyncAction(
            act,
            modelId,
            data as Parameters<typeof issueRelationStore.applySyncAction>[2],
          );
          if (act === 'D') {
            dexieDeletes.push({ id: modelId, table: 'issueRelations' });
          } else if (data) {
            dexieUpserts.issueRelations.push(data);
          }
          break;
        case 'IssueTemplate':
          issueTemplateStore.applySyncAction(
            act,
            modelId,
            data as Parameters<typeof issueTemplateStore.applySyncAction>[2],
          );
          if (act === 'D') {
            dexieDeletes.push({ id: modelId, table: 'issueTemplates' });
          } else if (data) {
            dexieUpserts.issueTemplates.push(data);
          }
          break;
        case 'Document':
          documentStore.applySyncAction(
            act,
            modelId,
            data as Parameters<typeof documentStore.applySyncAction>[2],
          );
          if (act === 'D') {
            dexieDeletes.push({ id: modelId, table: 'documents' });
          } else if (data) {
            dexieUpserts.documents.push(data);
          }
          break;
        case 'IssueActivity':
          // IssueActivity is queried per-issue via GraphQL when the detail panel opens;
          // we only persist it to Dexie for offline reads, no MobX store needed.
          // Batched into the closing transaction below — the prior per-row
          // awaits issued one round-trip per row on activity-heavy deltas.
          if (act === 'D') {
            dexieDeletes.push({ id: modelId, table: 'issueActivities' });
          } else if (data) {
            dexieUpserts.issueActivities.push(data);
          }
          break;
        case 'Initiative':
          initiativeStore.applySyncAction(
            act,
            modelId,
            data as Parameters<typeof initiativeStore.applySyncAction>[2],
          );
          if (act === 'D') {
            dexieDeletes.push({ id: modelId, table: 'initiatives' });
          } else if (data) {
            dexieUpserts.initiatives.push(data);
          }
          break;
        case 'InitiativeProject':
          initiativeStore.applyInitiativeProjectSyncAction(
            act,
            modelId,
            data as Parameters<typeof initiativeStore.applyInitiativeProjectSyncAction>[2],
          );
          if (act === 'D') {
            dexieDeletes.push({ id: modelId, table: 'initiativeProjects' });
          } else if (data) {
            dexieUpserts.initiativeProjects.push(data);
          }
          break;
      }

      // Update max sync cursor — `(committedAt, id)` tuple comparison.
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
        db.issueActivities,
        db.syncMetadata,
      ],
      async () => {
        await Promise.all([
          dexieUpserts.teams.length > 0 &&
            db.teams.bulkPut(dexieUpserts.teams as Parameters<typeof db.teams.bulkPut>[0]),
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
          dexieUpserts.issueActivities.length > 0 &&
            db.issueActivities.bulkPut(
              dexieUpserts.issueActivities as Parameters<typeof db.issueActivities.bulkPut>[0],
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
        setTimeout(() => {
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
      } else {
        syncStore.setStatus('offline');
      }
    });

    this.wsUnsubscribers.push(unsub1, unsub2);
    this.wsClient.connect();
  }

  /**
   * Coalesce drain notifications into a single delta-sync past the server's
   * 500ms watermark. Server has had at least 600ms (well past the watermark)
   * to flush the SyncAction, so the next delta is guaranteed to include it
   * even if the WS broadcast was lost in a reconnect handshake gap.
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
    }, 600);
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
