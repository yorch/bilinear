// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { UIStore } from './ui-store';

describe('UIStore sidebar preference', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('starts expanded even when a collapsed preference is stored (hydration-safe)', () => {
    localStorage.setItem('sidebar-collapsed', 'true');
    expect(new UIStore().sidebarCollapsed).toBe(false);
  });

  it('applies the stored preference only via restoreSidebarCollapsed', () => {
    localStorage.setItem('sidebar-collapsed', 'true');
    const store = new UIStore();
    store.restoreSidebarCollapsed();
    expect(store.sidebarCollapsed).toBe(true);
  });

  it('persists toggles', () => {
    const store = new UIStore();
    store.toggleSidebarCollapsed();
    expect(localStorage.getItem('sidebar-collapsed')).toBe('true');
  });
});
