import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api } from '../services/api';
import { initSocket, disconnectSocket } from '../services/socket';
import { queryClient } from '../services/queryClient';

interface User {
  user_id: string;
  username: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  role: string;
  roles: string[];
  primary_role: string;
  office?: string;
  position?: string;
  is_default_password?: boolean;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<User | null>;
  signup: (data: SignupData) => Promise<User | null>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  updateUser: (data: { username?: string; first_name: string; middle_name: string; last_name: string; office?: string; position?: string }) => Promise<void>;
}

interface SignupData {
  username: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  office: string;
  position: string;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export type { User, SignupData };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  // Keyed on the user id so profile refreshes (which replace the user object) keep the socket;
  // the socket only resets on login, logout, or switching accounts.
  const socketUserId = user?.user_id;
  useEffect(() => {
    if (socketUserId) {
      initSocket();
    }
    return () => {
      disconnectSocket();
    };
  }, [socketUserId]);

  const checkAuth = async () => {
    try {
      const response = await api.get('/auth/me', { 
        headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' } 
      });
      setUser(response.data);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  const refreshUser = async () => {
    const response = await api.get('/auth/me', {
      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
    });
    setUser(response.data);
  };

  // Cached server data belongs to whoever was signed in. Drop it before another account's first
  // render, so a shared office PC never shows the previous user's requests, even for a frame.
  const login = async (username: string, password: string): Promise<User | null> => {
    const response = await api.post('/auth/login', { username, password });
    if (!response.data.user) return null;
    queryClient.clear();
    setUser(response.data.user);
    const me = await api.get('/auth/me', {
      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
    });
    setUser(me.data);
    return me.data;
  };

  // Creates a client account on the default password and signs it in.
  const signup = async (data: SignupData): Promise<User | null> => {
    const response = await api.post('/auth/signup', data);
    if (!response.data.user) return null;
    queryClient.clear();
    const me = await api.get('/auth/me', {
      headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
    });
    setUser(me.data);
    return me.data;
  };

  const logout = async () => {
    await api.post('/auth/logout');
    queryClient.clear();
    setUser(null);
  };

  const updateUser = async (data: { username?: string; first_name: string; middle_name: string; last_name: string; office?: string; position?: string }) => {
    await api.put('/auth/update_profile', data);
    const response = await api.get('/auth/me');
    setUser(response.data);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, signup, logout, refreshUser, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
