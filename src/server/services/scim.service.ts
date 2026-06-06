import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../generated/prisma';
import { childLogger } from '../lib/logger';

const log = childLogger({ module: 'scim' });

export interface ScimTokenInfo {
  createdAt: Date;
  id: string;
  label: string;
  lastUsedAt: Date | null;
  revokedAt: Date | null;
}

export class ScimTokenNotFoundError extends Error {
  constructor() {
    super('SCIM token not found');
    this.name = 'ScimTokenNotFoundError';
  }
}

export class ScimService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Create a new SCIM provisioning token. The plaintext is returned only
   * here — never stored. Callers must show it to the user immediately.
   */
  async createToken(
    orgId: string,
    userId: string,
    label: string,
  ): Promise<{ id: string; plaintext: string }> {
    const plaintext = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(plaintext).digest('hex');
    const id = randomUUID();

    await this.prisma.scimToken.create({
      data: {
        createdAt: new Date(),
        createdById: userId,
        id,
        label,
        organizationId: orgId,
        tokenHash,
      },
    });

    log.info({ orgId, tokenId: id }, 'SCIM token created');
    return { id, plaintext };
  }

  /**
   * Revoke a token by setting revokedAt. Scoped to orgId to prevent
   * cross-tenant revocation.
   */
  async revokeToken(tokenId: string, orgId: string): Promise<void> {
    const result = await this.prisma.scimToken.updateMany({
      data: { revokedAt: new Date() },
      where: { id: tokenId, organizationId: orgId, revokedAt: null },
    });
    if (result.count === 0) {
      throw new ScimTokenNotFoundError();
    }
    log.info({ orgId, tokenId }, 'SCIM token revoked');
  }

  /**
   * List active (non-revoked) tokens for an org.
   */
  async listTokens(orgId: string): Promise<ScimTokenInfo[]> {
    return this.prisma.scimToken.findMany({
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, id: true, label: true, lastUsedAt: true, revokedAt: true },
      where: { organizationId: orgId, revokedAt: null },
    });
  }

  /**
   * Authenticate a Bearer token from an incoming SCIM request.
   * Returns { orgId } on success, null on failure.
   * Updates lastUsedAt on every successful auth.
   */
  async authenticateScimToken(bearer: string): Promise<{ orgId: string } | null> {
    const tokenHash = createHash('sha256').update(bearer).digest('hex');

    const token = await this.prisma.scimToken.findFirst({
      where: { revokedAt: null, tokenHash },
    });

    if (!token) {
      return null;
    }

    // Update lastUsedAt non-blocking so auth latency isn't penalised.
    void this.prisma.scimToken
      .update({ data: { lastUsedAt: new Date() }, where: { id: token.id } })
      .catch(err => {
        log.warn({ err, tokenId: token.id }, 'Failed to update SCIM token lastUsedAt');
      });

    return { orgId: token.organizationId };
  }
}
