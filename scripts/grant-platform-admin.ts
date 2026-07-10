import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma';

/**
 * Promote (or demote) a user to platform admin by email.
 *
 * The first user created in an *empty* deployment is auto-bootstrapped as the
 * platform admin (see UserService.isFirstUser). On an EXISTING database no one
 * has the flag yet, so this script grants it once to unlock the /admin console.
 * Idempotent — safe to re-run.
 *
 *   yarn admin:grant you@example.com
 *   yarn admin:grant you@example.com --revoke
 *
 * Note: --revoke here is a raw DB write and deliberately does NOT enforce the
 * "last platform admin" guard the console applies. Prefer the console for
 * revocation; use --revoke only for recovery/scripting.
 */

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL is not set');
}

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

async function main() {
  const args = process.argv.slice(2);
  const revoke = args.includes('--revoke');
  const email = args
    .find(a => !a.startsWith('--'))
    ?.trim()
    .toLowerCase();

  if (!email) {
    throw new Error('Usage: yarn admin:grant <email> [--revoke]');
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

  await prisma.user.update({
    data: { isPlatformAdmin: target },
    where: { id: user.id },
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
