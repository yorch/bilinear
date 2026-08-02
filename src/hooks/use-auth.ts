'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { GqlError, gql, gqlQuery, isGqlErrorCode } from '@/lib/graphql';
import { TransactionQueue } from '@/lib/transaction-queue';

interface AuthUser {
  displayName: string;
  email: string;
  id: string;
}

interface AuthState {
  error: string | null;
  loading: boolean;
  user: AuthUser | null;
}

const VIEWER_QUERY = `
  query Viewer {
    viewer {
      id
      displayName
      email
    }
  }
`;

export function useAuth() {
  const router = useRouter();
  const [state, setState] = useState<AuthState>({
    error: null,
    loading: true,
    user: null,
  });

  const fetchViewer = useCallback(async () => {
    try {
      const viewer = await gqlQuery<AuthUser>(VIEWER_QUERY, {}, 'viewer');
      setState({ error: null, loading: false, user: viewer });
    } catch (err) {
      // Not signed in is a state, not a failure: no error copy, no user.
      if (isGqlErrorCode(err, 'UNAUTHENTICATED')) {
        setState({ error: null, loading: false, user: null });
        return;
      }
      // A GraphQL-level failure surfaces the server's own message; a transport
      // failure has none worth showing, so it keeps the stringified throw.
      setState({
        error: err instanceof GqlError ? err.message : String(err),
        loading: false,
        user: null,
      });
    }
  }, []);

  useEffect(() => {
    fetchViewer();
  }, [fetchViewer]);

  const logout = useCallback(async () => {
    await gql('mutation { logout { success } }');
    await fetch('/api/auth/session', { method: 'DELETE' });

    // Drop the previous user's session reference so any racing enqueue
    // can't stamp a new transaction with stale ids before page navigation.
    TransactionQueue.clearActiveSession();
    setState({ error: null, loading: false, user: null });
    router.push('/login');
  }, [router]);

  return { ...state, logout, refetch: fetchViewer };
}
