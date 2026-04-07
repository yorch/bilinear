import { action, makeObservable, observable } from 'mobx';

export type SyncStatus =
  | 'idle'
  | 'bootstrapping'
  | 'syncing'
  | 'connected'
  | 'offline'
  | 'error';

export class SyncStore {
  lastSyncId = '0';
  status: SyncStatus = 'idle';
  error: string | null = null;
  wsConnected = false;

  constructor() {
    makeObservable(this, {
      error: observable,
      lastSyncId: observable,
      setError: action,
      setLastSyncId: action,
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
}
