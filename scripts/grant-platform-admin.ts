import { createInterface } from 'node:readline/promises';
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma';
import {
  LastPlatformAdminError,
  PlatformAdminService,
} from '../src/server/services/platform-admin.service';

/**
 * Promote (or demote) a user to platform admin by email.
 *
 * The first user created in an *empty* deployment is auto-bootstrapped as the
 * platform admin (see UserService.isFirstUser). On an EXISTING database no one
 * has the flag yet, so this script grants it once to unlock the /admin console.
 * Idempotent — safe to re-run.
 *
 *   yarn admin:grant you@example.com --yes
 *   yarn admin:grant you@example.com --revoke --yes
 *
 * `isPlatformAdmin` is the single most privileged flag in the system (it
 * unlocks cross-tenant reads/writes and impersonation via `/admin`), so this
 * script:
 *
 *   - requires explicit confirmation before mutating: pass `--yes` for
 *     non-interactive use (CI, one-liners), or omit it to get an interactive
 *     y/N prompt on a TTY. Running non-interactively (no TTY) without `--yes`
 *     aborts rather than silently proceeding.
 *   - routes the actual flag change through `PlatformAdminService.setPlatformAdmin`
 *     — the same service method the admin console's `platformUserSetAdmin`
 *     mutation calls — so the "never revoke the last platform admin" guard is
 *     enforced identically here, not hand-rolled/duplicated in this script.
 *   - writes a `platform_audit_logs` row via `PlatformAdminService.recordAudit`,
 *     mirroring the shape and action names (`user.platform_admin_granted` /
 *     `user.platform_admin_revoked`, targetType `'User'`) the console's
 *     resolver writes for the same mutation (see
 *     `src/server/graphql/resolvers/platform-admin.ts`). There's no
 *     authenticated actor for a CLI invocation, so `actorId` is recorded as
 *     `null` (the schema allows this — see `PlatformAuditLog.actorId`); the
 *     metadata field instead records that this came from the script, plus
 *     the local OS user and host, for whatever operational traceability is
 *     available outside a real session.
 */

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });
const platformAdmin = new PlatformAdminService(prisma);

async function confirm(message: string, autoYes: boolean): Promise<boolean> {
  if (autoYes) {
    return true;
  }
  if (!process.stdin.isTTY) {
    // Non-interactive with no --yes: refuse rather than silently mutating
    // the most privileged flag in the system from an unattended script run.
    console.error(
      `${message}\nRefusing to proceed without --yes (no TTY to confirm interactively).`,
    );
    return false;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(`${message} Type "yes" to confirm: `);
    return answer.trim().toLowerCase() === 'yes';
  } finally {
    rl.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const revoke = args.includes('--revoke');
  const autoYes = args.includes('--yes') || args.includes('-y');
  const email = args
    .find(a => !a.startsWith('--') && a !== '-y')
    ?.trim()
    .toLowerCase();

  if (!email) {
    throw new Error('Usage: yarn admin:grant <email> [--revoke] [--yes]');
  }

  const user = await prisma.user.findUnique({
    select: { email: true, id: true, isPlatformAdmin: true },
    where: { email },
  });
  if (!user) {
    throw new Error(`No user found with email "${email}".`);
  }

  const target = !revoke;
  if (user.isPlatformAdmin === target) {
    console.log(
      `No change: ${email} is already ${target ? 'a platform admin' : 'not a platform admin'}.`,
    );
    return;
  }

  const verb = target ? 'Grant' : 'Revoke';
  const confirmed = await confirm(`${verb} platform admin for ${email}?`, autoYes);
  if (!confirmed) {
    console.log('Aborted — no changes made.');
    process.exitCode = 1;
    return;
  }

  try {
    await platformAdmin.setPlatformAdmin(user.id, target);
  } catch (err) {
    if (err instanceof LastPlatformAdminError) {
      throw new Error(`Cannot revoke: ${email} is the last remaining platform admin.`);
    }
    throw err;
  }

  await platformAdmin.recordAudit({
    action: target ? 'user.platform_admin_granted' : 'user.platform_admin_revoked',
    actorId: null,
    metadata: {
      host: process.env.HOSTNAME ?? null,
      operator: process.env.USER ?? process.env.USERNAME ?? null,
      source: 'scripts/grant-platform-admin.ts',
    },
    targetId: user.id,
    targetType: 'User',
  });

  console.log(
    target
      ? `Granted platform admin to ${email}. They can now open /admin.`
      : `Revoked platform admin from ${email}.`,
  );
}

main()
  .catch(err => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
