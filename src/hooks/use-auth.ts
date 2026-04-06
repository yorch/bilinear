'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';

interface AuthUser {
  id: string;
  displayName: string;
  email: string;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  error: string | null;
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
      const res = await fetch('/api/graphql', {
        body: JSON.stringify({ query: VIEWER_QUERY }),
        headers: { 'Content-Type': 'application/json' },
        method: 'POST',
      });

      const data = await res.json();

      if (data.errors?.length) {
        const code = data.errors[0].extensions?.code;
        if (code === 'UNAUTHENTICATED') {
          setState({ error: null, loading: false, user: null });
          return;
        }
        setState({ error: data.errors[0].message, loading: false, user: null });
        return;
      }

      setState({ error: null, loading: false, user: data.data.viewer });
    } catch (err) {
      setState({ error: String(err), loading: false, user: null });
    }
  }, []);

  useEffect(() => {
    fetchViewer();
  }, [fetchViewer]);

  const logout = useCallback(async () => {
    await fetch('/api/graphql', {
      body: JSON.stringify({ query: 'mutation { logout { success } }' }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });

    await fetch('/api/auth/session', { method: 'DELETE' });

    setState({ error: null, loading: false, user: null });
    router.push('/login');
  }, [router]);

  return { ...state, logout, refetch: fetchViewer };
}
