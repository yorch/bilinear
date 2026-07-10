import { action, makeObservable, observable } from 'mobx';

export type SyncStatus = 'idle' | 'bootstrapping' | 'syncing' | 'connected' | 'offline' | 'error';

export class SyncStore {
  lastSyncId = '0';
  status: SyncStatus = 'idle';
  error: string | null = null;
  wsConnected = false;
  organizationName: string | null = null;
  /** Bumped by retryBootstrap() to re-trigger SyncProvider's init effect. */
  retryNonce = 0;

  constructor() {
    makeObservable(this, {
      error: observable,
      lastSyncId: observable,
      organizationName: observable,
      retryBootstrap: action,
      retryNonce: observable,
      setError: action,
      setLastSyncId: action,
      setOrganizationName: action,
      setStatus: action,
      setWsConnected: action,
      status: observable,
      wsConnected: observable,
    });
  }

  setLastSyncId(id: string) {
    this.lastSyncId = id;
  }

  setStatus(status: SyncStatus) {
    this.status = status;
  }

  setError(error: string | null) {
    this.error = error;
  }

  setWsConnected(connected: boolean) {
    this.wsConnected = connected;
  }

  setOrganizationName(name: string) {
    this.organizationName = name;
  }

  /** Re-run the bootstrap flow after a failed initial sync. */
  retryBootstrap() {
    this.status = 'bootstrapping';
    this.error = null;
    this.retryNonce++;
  }
}
