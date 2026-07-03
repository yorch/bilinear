import { beforeEach, describe, expect, it } from 'vitest';
import { TEST_ORG, TEST_USER, TEST_USER_2 } from '../../test/fixtures';
import { createMockPrisma } from '../../test/prisma-mock';
import { UserService } from './user.service';

describe('UserService', () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: UserService;

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new UserService(prisma as never);
  });

  describe('findById', () => {
    it('returns a user by id', async () => {
      prisma.user.findUnique.mockResolvedValue(TEST_USER);

      const result = await service.findById(TEST_USER.id);

      expect(result).toEqual(TEST_USER);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { id: TEST_USER.id },
      });
    });

    it('returns null when user does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.findById('nonexistent-id');

      expect(result).toBeNull();
    });
  });

  describe('findByEmail', () => {
    it('returns a user by email', async () => {
      prisma.user.findUnique.mockResolvedValue(TEST_USER);

      const result = await service.findByEmail(TEST_USER.email);

      expect(result).toEqual(TEST_USER);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({
        where: { email: TEST_USER.email },
      });
    });

    it('returns null when email does not exist', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      const result = await service.findByEmail('missing@example.com');

      expect(result).toBeNull();
    });
  });

  describe('findOrCreate', () => {
    it('returns existing user without changes when no googleId', async () => {
      prisma.user.findUnique.mockResolvedValue(TEST_USER);

      const result = await service.findOrCreate({
        email: TEST_USER.email,
        name: TEST_USER.name,
      });

      expect(result).toEqual(TEST_USER);
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('links googleId when existing user has none', async () => {
      const userWithoutGoogle = { ...TEST_USER, googleId: null };
      const updatedUser = { ...TEST_USER, googleId: 'google-123' };
      prisma.user.findUnique.mockResolvedValue(userWithoutGoogle);
      prisma.user.update.mockResolvedValue(updatedUser);

      const result = await service.findOrCreate({
        avatarUrl: 'https://example.com/avatar.jpg',
        email: TEST_USER.email,
        googleId: 'google-123',
        name: TEST_USER.name,
      });

      expect(result).toEqual(updatedUser);
      expect(prisma.user.update).toHaveBeenCalledWith({
        data: {
          avatarUrl: 'https://example.com/avatar.jpg',
          googleId: 'google-123',
        },
        where: { id: TEST_USER.id },
      });
    });

    it('returns existing user without update when googleId already linked', async () => {
      const userWithGoogle = { ...TEST_USER, googleId: 'existing-google-id' };
      prisma.user.findUnique.mockResolvedValue(userWithGoogle);

      const result = await service.findOrCreate({
        email: TEST_USER.email,
        googleId: 'new-google-id',
        name: TEST_USER.name,
      });

      expect(result).toEqual(userWithGoogle);
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('matches a returning OAuth user by provider id when their email changed', async () => {
      const linked = { ...TEST_USER, email: 'old@example.com', githubId: '42' };
      // First lookup is by githubId and hits — the email lookup never runs.
      prisma.user.findUnique.mockResolvedValueOnce(linked);

      const result = await service.findOrCreate({
        email: 'new@example.com',
        githubId: '42',
        name: TEST_USER.name,
      });

      expect(result).toEqual(linked);
      expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { githubId: '42' } });
      expect(prisma.user.create).not.toHaveBeenCalled();
      expect(prisma.user.update).not.toHaveBeenCalled();
    });

    it('does not clobber an existing avatar when linking a provider', async () => {
      const withAvatar = { ...TEST_USER, avatarUrl: 'https://example.com/custom.png' };
      prisma.user.findUnique
        .mockResolvedValueOnce(null) // githubId lookup misses
        .mockResolvedValueOnce(withAvatar); // email lookup hits
      prisma.user.update.mockResolvedValue({ ...withAvatar, githubId: '42' });

      await service.findOrCreate({
        avatarUrl: 'https://avatars.githubusercontent.com/u/42',
        email: TEST_USER.email,
        githubId: '42',
        name: TEST_USER.name,
      });

      expect(prisma.user.update).toHaveBeenCalledWith({
        data: { avatarUrl: 'https://example.com/custom.png', githubId: '42' },
        where: { id: TEST_USER.id },
      });
    });

    it('creates a new user with derived initials when none exists', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue(TEST_USER_2);

      await service.findOrCreate({
        email: TEST_USER_2.email,
        name: TEST_USER_2.name,
      });

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: TEST_USER_2.email,
          initials: 'OU', // "Other User" → "OU"
          name: TEST_USER_2.name,
        }),
      });
    });

    it('derives single-word initials as first two chars', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockResolvedValue({ ...TEST_USER, name: 'Alice' });

      await service.findOrCreate({ email: 'alice@example.com', name: 'Alice' });

      expect(prisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ initials: 'AL' }),
      });
    });
  });

  describe('getOrganizationForUser', () => {
    it('returns the organization for a user', async () => {
      prisma.organizationMember.findFirst.mockResolvedValue({
        organization: TEST_ORG,
        organizationId: TEST_ORG.id,
        userId: TEST_USER.id,
      });

      const result = await service.getOrganizationForUser(TEST_USER.id);

      expect(result).toEqual(TEST_ORG);
      expect(prisma.organizationMember.findFirst).toHaveBeenCalledWith({
        include: { organization: true },
        orderBy: { createdAt: 'asc' },
        where: { userId: TEST_USER.id },
      });
    });

    it('returns null when user has no organization', async () => {
      prisma.organizationMember.findFirst.mockResolvedValue(null);

      const result = await service.getOrganizationForUser(TEST_USER.id);

      expect(result).toBeNull();
    });
  });

  describe('updateLastSeen', () => {
    it('updates lastSeen when currentLastSeen is null', async () => {
      prisma.user.update.mockResolvedValue(TEST_USER);

      await service.updateLastSeen(TEST_USER.id, null);

      expect(prisma.user.update).toHaveBeenCalledWith({
        data: { lastSeen: expect.any(Date) },
        where: { id: TEST_USER.id },
      });
    });

    it('updates lastSeen when currentLastSeen is stale (>5 min ago)', async () => {
      const staleDate = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes ago
      prisma.user.update.mockResolvedValue(TEST_USER);

      await service.updateLastSeen(TEST_USER.id, staleDate);

      expect(prisma.user.update).toHaveBeenCalled();
    });

    it('skips the write when lastSeen is fresh (<5 min ago)', async () => {
      const recentDate = new Date(Date.now() - 60 * 1000); // 1 minute ago

      await service.updateLastSeen(TEST_USER.id, recentDate);

      expect(prisma.user.update).not.toHaveBeenCalled();
    });
  });
});
