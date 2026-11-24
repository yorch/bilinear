import { describe, expect, it } from 'vitest';
import { sectionsForRole } from './settings-nav';

const hrefs = (role: string | undefined) => sectionsForRole(role).map(s => s.href);

describe('sectionsForRole', () => {
  it('offers owners and admins every section', () => {
    expect(hrefs('owner')).toContain('/audit-log');
    expect(hrefs('admin')).toContain('/webhooks');
  });

  it('hides admin-only sections from members, guests and unresolved roles', () => {
    for (const role of ['member', 'guest', undefined]) {
      const visible = hrefs(role);
      expect(visible).not.toContain('/security');
      expect(visible).not.toContain('/audit-log');
      expect(visible).not.toContain('/integrations');
      expect(visible).toContain('');
    }
  });
});
