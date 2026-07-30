import { useCallback, useEffect, useState } from "react";
import { api, ApiError, type AuthUser } from "@/lib/api";

export function useAuth() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    api.me()
      .then(({ user: sessionUser }) => {
        if (active && sessionUser) setUser(sessionUser);
      })
      .catch((error) => {
        if (active && (!(error instanceof ApiError) || error.status !== 401)) {
          console.error("Unable to restore session", error);
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const result = await api.login(username, password);
    setUser(result.user);
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } finally {
      setUser(null);
    }
  }, []);

  return { user, loading, login, logout };
}
