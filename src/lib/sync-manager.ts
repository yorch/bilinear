import type { RootStore } from '@/stores/root-store';
import { db } from './db';
import type { SerializedSyncAction, WsClient } from './ws-client';

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

  constructor(stores: RootStore, wsClient: WsClient) {
    this.stores = stores;
    this.wsClient = wsClient;
  }

  async start(token: string) {
    const { syncStore } = this.stores;
    syncStore.setStatus('bootstrapping');

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

    // Connect WebSocket for real-time updates
    this.setupWebSocket(token);

    // Offline / online detection
    window.addEventListener('online', this.handleOnline);
    window.addEventListener('offline', this.handleOffline);
  }

  stop() {
    for (const unsub of this.wsUnsubscribers) {
      unsub();
    }
    this.wsUnsubscribers = [];
    this.wsClient.disconnect();
    window.removeEventListener('online', this.handleOnline);
    window.removeEventListener('offline', this.handleOffline);
  }

  // ─── Private methods ────────────────────────────────────────────────────────

  private async loadFromIndexedDB(): Promise<boolean> {
    const [
      orgs,
      teams,
      users,
      states,
      labels,
      issues,
      projects,
      projectMilestones,
      meta,
    ] = await Promise.all([
      db.organizations.toArray(),
      db.teams.toArray(),
      db.users.toArray(),
      db.workflowStates.toArray(),
      db.issueLabels.toArray(),
      db.issues.toArray(),
      db.projects.toArray(),
      db.projectMilestones.toArray(),
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
      projectStore,
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
      projectStore.upsertMany(projects);
      projectStore.upsertMilestones(projectMilestones);
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
      projectStore,
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
        issueLabels: [] as object[],
        issues: [] as object[],
        organizations: [] as object[],
        projectMilestones: [] as object[],
        projects: [] as object[],
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
          db.projects,
          db.projectMilestones,
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
            db.projects.clear(),
            db.projectMilestones.clear(),
          ]);
          await Promise.all([
            db.organizations.bulkPut(
              batches.organizations as Parameters<
                typeof db.organizations.bulkPut
              >[0],
            ),
            db.teams.bulkPut(
              batches.teams as Parameters<typeof db.teams.bulkPut>[0],
            ),
            db.users.bulkPut(
              batches.users as Parameters<typeof db.users.bulkPut>[0],
            ),
            db.workflowStates.bulkPut(
              batches.workflowStates as Parameters<
                typeof db.workflowStates.bulkPut
              >[0],
            ),
            db.issueLabels.bulkPut(
              batches.issueLabels as Parameters<
                typeof db.issueLabels.bulkPut
              >[0],
            ),
            db.issues.bulkPut(
              batches.issues as Parameters<typeof db.issues.bulkPut>[0],
            ),
            db.projects.bulkPut(
              batches.projects as Parameters<typeof db.projects.bulkPut>[0],
            ),
            db.projectMilestones.bulkPut(
              batches.projectMilestones as Parameters<
                typeof db.projectMilestones.bulkPut
              >[0],
            ),
            db.syncMetadata.put({ key: 'lastSyncId', value: lastSyncId }),
          ]);
        },
      );

      // Populate MobX stores
      const firstOrg = batches.organizations[0] as
        | { name?: string }
        | undefined;
      if (firstOrg?.name) {
        syncStore.setOrganizationName(firstOrg.name);
      }
      teamStore.upsertMany(
        batches.teams as Parameters<typeof teamStore.upsertMany>[0],
      );
      userStore.upsertMany(
        batches.users as Parameters<typeof userStore.upsertMany>[0],
      );
      workflowStateStore.upsertMany(
        batches.workflowStates as Parameters<
          typeof workflowStateStore.upsertMany
        >[0],
      );
      labelStore.upsertMany(
        batches.issueLabels as Parameters<typeof labelStore.upsertMany>[0],
      );
      issueStore.upsertMany(
        batches.issues as Parameters<typeof issueStore.upsertMany>[0],
      );
      projectStore.upsertMany(
        batches.projects as Parameters<typeof projectStore.upsertMany>[0],
      );
      projectStore.upsertMilestones(
        batches.projectMilestones as Parameters<
          typeof projectStore.upsertMilestones
        >[0],
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
    const lastSyncId = syncStore.lastSyncId;

    try {
      const res = await fetch(
        `/api/sync/delta?lastSyncId=${encodeURIComponent(lastSyncId)}`,
        { credentials: 'include' },
      );

      if (!res.ok) {
        // Delta failed — fall back to full bootstrap
        this.isDeltaSyncing = false;
        await this.fullBootstrap();
        return;
      }

      const actions = (await res.json()) as SerializedSyncAction[];
      await this.applyActions(actions);
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
      projectStore,
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
      organizations: object[];
      projects: object[];
      projectMilestones: object[];
    } = {
      issueLabels: [],
      issues: [],
      organizations: [],
      projectMilestones: [],
      projects: [],
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
        | 'projects'
        | 'projectMilestones';
      id: string;
    }[] = [];

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
      }

      // Update max sync ID
      if (BigInt(action.id) > BigInt(maxId)) {
        maxId = action.id;
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
        db.projects,
        db.projectMilestones,
        db.syncMetadata,
      ],
      async () => {
        await Promise.all([
          dexieUpserts.teams.length > 0 &&
            db.teams.bulkPut(
              dexieUpserts.teams as Parameters<typeof db.teams.bulkPut>[0],
            ),
          dexieUpserts.users.length > 0 &&
            db.users.bulkPut(
              dexieUpserts.users as Parameters<typeof db.users.bulkPut>[0],
            ),
          dexieUpserts.workflowStates.length > 0 &&
            db.workflowStates.bulkPut(
              dexieUpserts.workflowStates as Parameters<
                typeof db.workflowStates.bulkPut
              >[0],
            ),
          dexieUpserts.issueLabels.length > 0 &&
            db.issueLabels.bulkPut(
              dexieUpserts.issueLabels as Parameters<
                typeof db.issueLabels.bulkPut
              >[0],
            ),
          dexieUpserts.issues.length > 0 &&
            db.issues.bulkPut(
              dexieUpserts.issues as Parameters<typeof db.issues.bulkPut>[0],
            ),
          dexieUpserts.projects.length > 0 &&
            db.projects.bulkPut(
              dexieUpserts.projects as Parameters<
                typeof db.projects.bulkPut
              >[0],
            ),
          dexieUpserts.projectMilestones.length > 0 &&
            db.projectMilestones.bulkPut(
              dexieUpserts.projectMilestones as Parameters<
                typeof db.projectMilestones.bulkPut
              >[0],
            ),
          db.syncMetadata.put({ key: 'lastSyncId', value: maxId }),
        ]);
        await Promise.all(
          dexieDeletes.map(({ table, id }) => db[table].delete(id)),
        );
      },
    );
  }

  private setupWebSocket(token: string) {
    const unsub1 = this.wsClient.onMessage(async msg => {
      if (msg.cmd === 'sync') {
        await this.applyActions(msg.sync);
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
    this.wsClient.connect(token);
  }

  private handleOnline = () => {
    const { syncStore } = this.stores;
    syncStore.setStatus('syncing');
    this.deltaSync();
  };

  private handleOffline = () => {
    this.stores.syncStore.setStatus('offline');
  };
}
