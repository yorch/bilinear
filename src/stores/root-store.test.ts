import { describe, expect, it } from 'vitest';
import { RootStore } from './root-store';

describe('RootStore.clearEntityPools', () => {
  it('empties every entity map across every store', () => {
    const store = new RootStore();

    store.teamStore.upsertMany([{ id: 't-1' }] as never);
    store.issueStore.upsertMany([{ id: 'i-1', identifier: 'ENG-1' }] as never);
    store.projectStore.upsertMany([{ id: 'p-1' }] as never);
    store.notificationStore.upsertMany([{ id: 'n-1' }] as never);

    expect(store.teamStore.pool.size).toBe(1);
    expect(store.issueStore.pool.size).toBe(1);

    store.clearEntityPools();

    expect(store.teamStore.pool.size).toBe(0);
    expect(store.issueStore.pool.size).toBe(0);
    expect(store.projectStore.pool.size).toBe(0);
    expect(store.notificationStore.pool.size).toBe(0);
  });

  it('reaches the secondary maps on stores that hold more than one', () => {
    // This is why the clear is reflective rather than a hand-written list:
    // several stores hold more than a `pool`, and a list misses the next one.
    const store = new RootStore();
    store.customFieldStore.definitions.set('d-1', { id: 'd-1' } as never);
    store.customFieldStore.values.set('v-1', { id: 'v-1' } as never);

    store.clearEntityPools();

    expect(store.customFieldStore.definitions.size).toBe(0);
    expect(store.customFieldStore.values.size).toBe(0);
  });

  it('leaves session state alone', () => {
    // Wiping `syncStore` mid-bootstrap would drop the very status the bootstrap
    // reports through, and `userStore.currentUserId` gates the Notification
    // recipient filter in SyncManager.
    const store = new RootStore();
    store.syncStore.setLastSyncId('123-456');
    store.userStore.setCurrentUserId('u-1');

    store.clearEntityPools();

    expect(store.syncStore.lastSyncId).toBe('123-456');
    expect(store.userStore.currentUserId).toBe('u-1');
  });
});
