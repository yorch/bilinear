/**
 * Prove the configuration system's layering and storage guarantees against a
 * real Postgres. Run with `yarn db:verify:config` (needs a live database).
 *
 * Unit tests mock Prisma, so they can assert that `ConfigService` issues the
 * right calls but not that the *database* behaves as the design assumes. The
 * properties below are exactly the ones a mock cannot check:
 *
 * - the `(scope_type, scope_id, key)` unique index actually deduplicates,
 *   including for platform-scope rows. This is why `scope_id` is NOT NULL with
 *   an all-zeroes sentinel: Postgres unique indexes are NULLS DISTINCT by
 *   default, so a nullable column would silently allow duplicate platform rows
 *   and the resolver would pick an arbitrary one.
 * - precedence across real stored rows (platform → org → team), and that one
 *   org's row does not leak into another's resolution.
 * - `clear()` genuinely falls through to the layer below rather than writing a
 *   sentinel.
 * - a row whose stored JSON no longer matches its declaration is ignored
 *   rather than thrown — the generic table has no column type to catch it.
 *
 * WARNING: deletes every row in `settings`. Point it at a scratch database.
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import { PLATFORM_SCOPE_ID } from '../src/lib/config';
import { ConfigService } from '../src/server/config/config.service';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

async function main() {
  const config = new ConfigService(prisma);
  const orgId = '11111111-1111-1111-1111-111111111111';
  const teamId = '22222222-2222-2222-2222-222222222222';
  let failures = 0;
  const check = (name: string, ok: boolean, detail = '') => {
    if (!ok) {
      failures++;
    }
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  };

  await prisma.setting.deleteMany({});

  // 1. Code default when nothing is stored.
  const d = await config.explain('limits.maxInitiativeDepth', { orgId });
  check(
    'code default resolves',
    d.value === 5 && d.source === 'code-default',
    `${d.value}/${d.source}`,
  );

  // 2. Platform layer overrides the code default.
  await config.set('limits.maxInitiativeDepth', 'platform', PLATFORM_SCOPE_ID, 7, null);
  const p = await config.explain('limits.maxInitiativeDepth', { orgId });
  check(
    'platform layer wins over code default',
    p.value === 7 && p.source === 'platform',
    `${p.value}/${p.source}`,
  );

  // 3. Org layer overrides platform.
  await config.set('limits.maxInitiativeDepth', 'org', orgId, 3, null);
  const o = await config.explain('limits.maxInitiativeDepth', { orgId });
  check(
    'org layer wins over platform',
    o.value === 3 && o.source === 'org',
    `${o.value}/${o.source}`,
  );

  // 4. A different org still sees the platform value.
  const other = await config.explain('limits.maxInitiativeDepth', {
    orgId: '33333333-3333-3333-3333-333333333333',
  });
  check('other org unaffected by first org row', other.value === 7, String(other.value));

  // 5. Team layer wins over org for a team-scoped knob.
  await config.set('cycles.upcomingCount', 'org', orgId, 9, null);
  await config.set('cycles.upcomingCount', 'team', teamId, 4, null);
  const t = await config.explain('cycles.upcomingCount', { orgId, teamId });
  check('team layer wins over org', t.value === 4 && t.source === 'team', `${t.value}/${t.source}`);
  const noTeam = await config.explain('cycles.upcomingCount', { orgId });
  check('falls back to org without a team id', noTeam.value === 9, String(noTeam.value));

  // 6. clear() falls back to the layer below.
  await config.clear('limits.maxInitiativeDepth', 'org', orgId);
  const cleared = await config.explain('limits.maxInitiativeDepth', { orgId });
  check(
    'clear falls back to platform',
    cleared.value === 7 && cleared.source === 'platform',
    `${cleared.value}`,
  );

  // 7. Upsert, not duplicate: the unique index holds.
  await config.set('limits.maxExportRows', 'org', orgId, 100, null);
  await config.set('limits.maxExportRows', 'org', orgId, 200, null);
  const rows = await prisma.setting.count({
    where: { key: 'limits.maxExportRows', scopeId: orgId },
  });
  check('repeated set upserts one row', rows === 1, `${rows} rows`);

  // 8. The platform sentinel is constrained by the same unique index — the
  //    reason scope_id is NOT NULL rather than nullable.
  await config.set('limits.maxExportRows', 'platform', PLATFORM_SCOPE_ID, 50, null);
  await config.set('limits.maxExportRows', 'platform', PLATFORM_SCOPE_ID, 60, null);
  const platRows = await prisma.setting.count({
    where: { key: 'limits.maxExportRows', scopeType: 'platform' },
  });
  check('platform sentinel rows are deduplicated', platRows === 1, `${platRows} rows`);

  // 9. Validation rejects out-of-bounds and wrong types.
  let rejected = false;
  try {
    await config.set('limits.maxInitiativeDepth', 'org', orgId, 999, null);
  } catch {
    rejected = true;
  }
  check('out-of-bounds write rejected', rejected);

  rejected = false;
  try {
    await config.set('limits.maxInitiativeDepth', 'org', orgId, 'abc', null);
  } catch {
    rejected = true;
  }
  check('wrong-type write rejected', rejected);

  // 10. Writing at a scope the knob does not declare is rejected.
  rejected = false;
  try {
    await config.set('limits.maxInitiativeDepth', 'team', teamId, 3, null);
  } catch {
    rejected = true;
  }
  check('write to undeclared scope rejected', rejected);

  // 11. env-only knobs are never writable.
  rejected = false;
  try {
    await config.set('env.JWT_SECRET', 'platform', PLATFORM_SCOPE_ID, 'x', null);
  } catch {
    rejected = true;
  }
  check('env-only knob is not writable', rejected);

  // 12. A redacted knob never returns its value.
  process.env.JWT_SECRET = 'super-secret-value';
  const redacted = await config.explain('env.JWT_SECRET');
  check(
    'redacted knob hides its value',
    redacted.value === null && redacted.locked,
    JSON.stringify(redacted.value),
  );

  // 13. The security guards are env-only: not merely "env wins", but "there is
  //     no stored layer at all". A DB-storable SSRF kill switch would let a
  //     compromised admin session disable the guard with a mutation, so the
  //     write must be refused outright rather than silently overridden.
  rejected = false;
  try {
    await config.set('security.allowPrivateWebhookUrls', 'platform', PLATFORM_SCOPE_ID, true, null);
  } catch {
    rejected = true;
  }
  check('security guard cannot be stored at all', rejected);

  process.env.ALLOW_PRIVATE_WEBHOOK_URLS = '1';
  const ov = await config.explain('security.allowPrivateWebhookUrls');
  check(
    'security guard reads from env and reports locked',
    ov.value === true && ov.locked && ov.source === 'env',
    `${ov.value}/${ov.source}`,
  );
  delete process.env.ALLOW_PRIVATE_WEBHOOK_URLS;
  config.clearCache();
  const off = await config.explain('security.allowPrivateWebhookUrls');
  check('security guard defaults closed when env is unset', off.value === false, String(off.value));

  // 14. default-mode env sits below stored layers.
  process.env.WEBHOOK_MAX_ATTEMPTS = '9';
  config.clearCache();
  const envDefault = await config.explain('webhook.maxAttempts', { orgId });
  check(
    'default-mode env replaces the code default',
    envDefault.value === 9 && envDefault.source === 'env',
    `${envDefault.value}/${envDefault.source}`,
  );
  await config.set('webhook.maxAttempts', 'org', orgId, 2, null);
  const stored = await config.explain('webhook.maxAttempts', { orgId });
  check(
    'stored value beats default-mode env',
    stored.value === 2 && stored.source === 'org',
    `${stored.value}/${stored.source}`,
  );
  delete process.env.WEBHOOK_MAX_ATTEMPTS;

  // 15. A stored row whose shape no longer matches is ignored, not fatal.
  await prisma.setting.updateMany({
    data: { value: 'not-a-number' },
    where: { key: 'webhook.maxAttempts', scopeId: orgId },
  });
  config.clearCache();
  const bad = await config.explain('webhook.maxAttempts', { orgId });
  check(
    'malformed stored row falls through instead of throwing',
    bad.value === 5,
    String(bad.value),
  );

  // 16. deleteScope removes a scope's rows (no FK cascade exists).
  const removed = await config.deleteScope('org', orgId);
  check('deleteScope removes rows', removed > 0, `${removed} rows`);

  // 17. pruneUnknownKeys drops rows for retired keys.
  await prisma.setting.create({
    data: { key: 'retired.knob', scopeId: orgId, scopeType: 'org', value: 1 },
  });
  const pruned = await config.pruneUnknownKeys();
  check('pruneUnknownKeys drops undeclared keys', pruned === 1, `${pruned} rows`);

  await prisma.setting.deleteMany({});
  console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().finally(() => prisma.$disconnect());
