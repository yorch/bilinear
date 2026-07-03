/**
 * Client helpers for the platform-admin console. Thin wrappers over the shared
 * `gql` fetch helper plus the two impersonation API routes. Each function
 * throws on GraphQL errors so callers can `try/catch` and toast.
 */
import { gql } from './graphql';
import { gqlError } from './utils';

export interface PlatformMetrics {
  activeOrgs: number;
  activeUsers: number;
  newOrgs7d: number;
  newOrgs30d: number;
  newUsers7d: number;
  newUsers30d: number;
  platformAdmins: number;
  suspendedOrgs: number;
  suspendedUsers: number;
  topOrgs: Array<{
    id: string;
    name: string;
    urlKey: string;
    issueCount: number;
    memberCount: number;
  }>;
  totalIssues: number;
  totalOrgs: number;
  totalUsers: number;
}

export interface PlatformTenant {
  archivedAt: string | null;
  createdAt: string;
  dataRegion: string;
  id: string;
  issueCount: number;
  memberCount: number;
  name: string;
  suspendedAt: string | null;
  suspendedReason: string | null;
  urlKey: string;
}

export interface PlatformUserOrg {
  id: string;
  name: string;
  role: string;
  urlKey: string;
}

export interface PlatformUser {
  active: boolean;
  createdAt: string;
  displayName: string;
  email: string;
  id: string;
  isPlatformAdmin: boolean;
  lastSeen: string | null;
  organizations: PlatformUserOrg[];
}

export interface PlatformAuditEntry {
  action: string;
  actor: { id: string; displayName: string; email: string } | null;
  createdAt: string;
  id: string;
  ipAddress: string | null;
  metadata: Record<string, unknown> | null;
  targetId: string | null;
  targetType: string | null;
}

const TENANT_FIELDS = `
  id name urlKey dataRegion suspendedAt suspendedReason archivedAt createdAt
  memberCount issueCount
`;

const USER_FIELDS = `
  id email displayName active isPlatformAdmin lastSeen createdAt
  organizations { id name urlKey role }
`;

/** Run a GraphQL op and unwrap `data[key]`, throwing on any error. */
async function run<T>(query: string, variables: Record<string, unknown>, key: string): Promise<T> {
  const res = await gql(query, variables);
  if (res.errors?.length) {
    throw new Error(gqlError(res, 'Request failed'));
  }
  return (res.data as Record<string, T>)[key];
}

export function fetchMetrics(): Promise<PlatformMetrics> {
  return run(
    `query PlatformMetrics {
      platformMetrics {
        totalOrgs activeOrgs suspendedOrgs
        totalUsers activeUsers suspendedUsers platformAdmins
        totalIssues newUsers7d newUsers30d newOrgs7d newOrgs30d
        topOrgs { id name urlKey issueCount memberCount }
      }
    }`,
    {},
    'platformMetrics',
  );
}

export function fetchTenants(query: string, includeArchived: boolean): Promise<PlatformTenant[]> {
  return run(
    `query PlatformTenants($query: String, $includeArchived: Boolean) {
      platformTenants(query: $query, includeArchived: $includeArchived) { ${TENANT_FIELDS} }
    }`,
    { includeArchived, query: query || null },
    'platformTenants',
  );
}

export function suspendTenant(id: string, reason: string | null): Promise<PlatformTenant> {
  return run(
    `mutation Suspend($id: ID!, $reason: String) {
      platformTenantSuspend(id: $id, reason: $reason) { ${TENANT_FIELDS} }
    }`,
    { id, reason },
    'platformTenantSuspend',
  );
}

export function restoreTenant(id: string): Promise<PlatformTenant> {
  return run(
    `mutation Restore($id: ID!) {
      platformTenantRestore(id: $id) { ${TENANT_FIELDS} }
    }`,
    { id },
    'platformTenantRestore',
  );
}

export function deleteTenant(id: string): Promise<PlatformTenant> {
  return run(
    `mutation DeleteTenant($id: ID!) {
      platformTenantDelete(id: $id) { ${TENANT_FIELDS} }
    }`,
    { id },
    'platformTenantDelete',
  );
}

export function fetchUsers(query: string): Promise<PlatformUser[]> {
  return run(
    `query PlatformUsers($query: String) {
      platformUsers(query: $query) { ${USER_FIELDS} }
    }`,
    { query: query || null },
    'platformUsers',
  );
}

export function suspendUser(id: string): Promise<PlatformUser> {
  return run(
    `mutation SuspendUser($id: ID!) { platformUserSuspend(id: $id) { ${USER_FIELDS} } }`,
    { id },
    'platformUserSuspend',
  );
}

export function reactivateUser(id: string): Promise<PlatformUser> {
  return run(
    `mutation ReactivateUser($id: ID!) { platformUserReactivate(id: $id) { ${USER_FIELDS} } }`,
    { id },
    'platformUserReactivate',
  );
}

export function setUserAdmin(id: string, isPlatformAdmin: boolean): Promise<PlatformUser> {
  return run(
    `mutation SetAdmin($id: ID!, $isPlatformAdmin: Boolean!) {
      platformUserSetAdmin(id: $id, isPlatformAdmin: $isPlatformAdmin) { ${USER_FIELDS} }
    }`,
    { id, isPlatformAdmin },
    'platformUserSetAdmin',
  );
}

export function fetchAuditLog(
  cursor: string | null,
): Promise<{ entries: PlatformAuditEntry[]; hasMore: boolean; nextCursor: string | null }> {
  return run(
    `query PlatformAudit($cursor: String) {
      platformAuditLog(cursor: $cursor) {
        entries {
          id action targetType targetId metadata ipAddress createdAt
          actor { id displayName email }
        }
        hasMore nextCursor
      }
    }`,
    { cursor },
    'platformAuditLog',
  );
}

/** Start impersonating a user. On success returns the workspace urlKey to redirect to. */
export async function startImpersonation(userId: string, orgId?: string): Promise<string> {
  const res = await fetch('/api/admin/impersonate', {
    body: JSON.stringify({ orgId, userId }),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  const data = (await res.json().catch(() => ({}))) as { urlKey?: string; error?: string };
  if (!res.ok || !data.urlKey) {
    throw new Error(data.error || 'Failed to start impersonation');
  }
  return data.urlKey;
}

/** End the current impersonation session (restores the admin's own session). */
export async function stopImpersonation(): Promise<void> {
  const res = await fetch('/api/admin/impersonate/stop', {
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || 'Failed to stop impersonation');
  }
}
