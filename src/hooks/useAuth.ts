import { useCallback, useState } from 'react';

export function useAuth() {
  const [token, setToken] = useState<string | null>(null);

  const signOut = useCallback(() => {
    setToken(null);
  }, []);

  return { token, setToken, signOut, isSignedIn: Boolean(token) };
}
