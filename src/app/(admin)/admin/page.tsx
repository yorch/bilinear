'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { fetchMetrics, type PlatformMetrics } from '@/lib/admin-api';

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <p className="text-xs font-medium uppercase tracking-wide text-zinc-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">{value}</p>
      {sub ? <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{sub}</p> : null}
    </div>
  );
}

export default function AdminDashboardPage() {
  const [metrics, setMetrics] = useState<PlatformMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMetrics()
      .then(m => {
        if (!cancelled) {
          setMetrics(m);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) {
          setError(e.message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <p className="text-sm text-zinc-400">Loading platform metrics…</p>;
  }
  if (error || !metrics) {
    return <p className="text-sm text-red-500">{error ?? 'Failed to load metrics.'}</p>;
  }

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Platform overview
        </h1>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          Cross-tenant metrics across every organization in this deployment.
        </p>
      </div>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Organizations
        </h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Total" value={metrics.totalOrgs} />
          <StatCard label="Active" value={metrics.activeOrgs} />
          <StatCard label="Suspended" value={metrics.suspendedOrgs} />
          <StatCard
            label="New (30d)"
            sub={`${metrics.newOrgs7d} in last 7d`}
            value={metrics.newOrgs30d}
          />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">Users</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Total" value={metrics.totalUsers} />
          <StatCard label="Active" value={metrics.activeUsers} />
          <StatCard label="Suspended" value={metrics.suspendedUsers} />
          <StatCard label="Platform admins" value={metrics.platformAdmins} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard
            label="New users (30d)"
            sub={`${metrics.newUsers7d} in last 7d`}
            value={metrics.newUsers30d}
          />
          <StatCard label="Total issues" value={metrics.totalIssues} />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-400">
          Most active organizations
        </h2>
        {metrics.topOrgs.length === 0 ? (
          <p className="text-sm text-zinc-400">No organizations yet.</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-zinc-200 dark:border-zinc-800">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-zinc-200 bg-zinc-50 text-left text-xs font-medium text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-400">
                  <th className="px-4 py-2">Organization</th>
                  <th className="px-4 py-2 text-right">Members</th>
                  <th className="px-4 py-2 text-right">Issues</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                {metrics.topOrgs.map(o => (
                  <tr className="bg-white dark:bg-zinc-950" key={o.id}>
                    <td className="px-4 py-2">
                      <Link
                        className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                        href={`/admin/tenants?q=${encodeURIComponent(o.urlKey)}`}
                      >
                        {o.name}
                      </Link>
                      <span className="ml-2 font-mono text-xs text-zinc-400">{o.urlKey}</span>
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                      {o.memberCount}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-zinc-600 dark:text-zinc-300">
                      {o.issueCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
