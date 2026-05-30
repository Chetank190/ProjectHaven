import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import api from '../api/client';

export interface AuthUser { email: string; name: string; role: string; }

interface AuthContextType {
  user:     AuthUser | null;
  token:    string | null;
  loading:  boolean;
  login:    (email: string, password: string) => Promise<void>;
  register: (email: string, name: string, password: string) => Promise<void>;
  logout:   () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

const TOKEN_KEY = 'haven_auth_token';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,    setUser]    = useState<AuthUser | null>(null);
  const [token,   setToken]   = useState<string | null>(() => localStorage.getItem(TOKEN_KEY));
  const [loading, setLoading] = useState(true);

  const applyToken = useCallback((tok: string, u: AuthUser) => {
    localStorage.setItem(TOKEN_KEY, tok);
    api.defaults.headers.common['Authorization'] = `Bearer ${tok}`;
    setToken(tok);
    setUser(u);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    delete api.defaults.headers.common['Authorization'];
    setToken(null);
    setUser(null);
  }, []);

  // Restore session from stored token on mount
  useEffect(() => {
    const stored = localStorage.getItem(TOKEN_KEY);
    if (!stored) { setLoading(false); return; }
    api.defaults.headers.common['Authorization'] = `Bearer ${stored}`;
    api.get<AuthUser>('/auth/me')
      .then(r => { setUser(r.data); setToken(stored); })
      .catch(() => logout())          // token expired or invalid → clear
      .finally(() => setLoading(false));
  }, [logout]);

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.post<{ token: string; user: AuthUser }>('/auth/login', { email, password });
    applyToken(r.data.token, r.data.user);
  }, [applyToken]);

  const register = useCallback(async (email: string, name: string, password: string) => {
    const r = await api.post<{ token: string; user: AuthUser }>('/auth/register', { email, name, password });
    applyToken(r.data.token, r.data.user);
  }, [applyToken]);

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
