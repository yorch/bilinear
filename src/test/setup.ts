import { vi } from 'vitest';

// Mock environment variables for tests
// Both >= 32 bytes to satisfy HS256 entropy check in src/server/lib/jwt.ts
process.env.JWT_SECRET = 'test-jwt-secret-for-unit-tests-0123456789abcdef';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-for-unit-tests-0123456789abcdef';
process.env.DATABASE_URL = 'postgresql://test:test@localhost:5432/test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.APP_URL = 'http://localhost:3000';

// Mock nodemailer — provide both default (for ESM default import) and named export
vi.mock('nodemailer', () => {
  const createTransport = () => ({
    sendMail: vi.fn().mockResolvedValue({ messageId: 'test' }),
  });
  return {
    createTransport,
    default: { createTransport },
  };
});
