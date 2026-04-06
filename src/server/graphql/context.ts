import type { NextRequest } from 'next/server';
import { prisma } from '../lib/prisma';
import type { AuthContext } from '../middleware/auth';
import { extractAuthContext } from '../middleware/auth';
import { AuthService } from '../services/auth.service';
import { UserService } from '../services/user.service';

export interface GraphQLContext extends AuthContext {
  services: {
    auth: AuthService;
    user: UserService;
  };
}

export async function createContext(req: NextRequest): Promise<GraphQLContext> {
  const authHeader = req.headers.get('authorization');
  const cookieToken = req.cookies.get('access_token')?.value ?? null;

  const auth = await extractAuthContext(authHeader, cookieToken);

  const userService = new UserService(prisma);
  const authService = new AuthService(prisma, userService);

  return {
    ...auth,
    services: {
      auth: authService,
      user: userService,
    },
  };
}
