'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { gql } from '@/lib/graphql';

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
      const data = await gql(VIEWER_QUERY);

      if (data.errors?.length) {
        const err = data.errors[0] as {
          message: string;
          extensions?: { code: string };
        };
        if (err.extensions?.code === 'UNAUTHENTICATED') {
          setState({ error: null, loading: false, user: null });
          return;
        }
        setState({ error: err.message, loading: false, user: null });
        return;
      }

      setState({
        error: null,
        loading: false,
        user: (data.data as { viewer: AuthUser }).viewer,
      });
    } catch (err) {
      setState({ error: String(err), loading: false, user: null });
    }
  }, []);

  useEffect(() => {
    fetchViewer();
  }, [fetchViewer]);

  const logout = useCallback(async () => {
    await gql('mutation { logout { success } }');
    await fetch('/api/auth/session', { method: 'DELETE' });

    setState({ error: null, loading: false, user: null });
    router.push('/login');
  }, [router]);

  return { ...state, logout, refetch: fetchViewer };
}
