import crypto from 'node:crypto';
import { PrismaClient } from '../src/generated/prisma';

const prisma = new PrismaClient();

const DEMO_EMAIL = 'demo@example.com';
const DEMO_CODE = '123456';

function hashToken(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

async function main() {
  const user = await prisma.user.upsert({
    create: {
      avatarBgColor: '#6366f1',
      displayName: 'Demo User',
      email: DEMO_EMAIL,
      initials: 'DU',
      name: 'Demo User',
    },
    update: {},
    where: { email: DEMO_EMAIL },
  });

  const org = await prisma.organization.upsert({
    create: { name: 'Demo Org', urlKey: 'demo' },
    update: {},
    where: { urlKey: 'demo' },
  });

  await prisma.organizationMember.upsert({
    create: { organizationId: org.id, role: 'owner', userId: user.id },
    update: {},
    where: {
      organizationId_userId: { organizationId: org.id, userId: user.id },
    },
  });

  // Revoke any existing magic link tokens so only the seeded one is active
  await prisma.authToken.updateMany({
    data: { revokedAt: new Date() },
    where: { revokedAt: null, type: 'magic_link', userId: user.id },
  });

  // Long-lived token (1 year) — for local dev only
  await prisma.authToken.create({
    data: {
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      tokenHash: hashToken(DEMO_CODE),
      type: 'magic_link',
      userId: user.id,
    },
  });

  console.log('Seed complete.');
  console.log(`  Email : ${DEMO_EMAIL}`);
  console.log(`  Code  : ${DEMO_CODE}`);
  console.log(`  Org   : ${org.urlKey}`);
  console.log('\nGo to /login, enter the email, then use the code above.');
}

main()
  .catch(err => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
