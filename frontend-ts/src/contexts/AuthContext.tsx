import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { api } from '../services/api';
import { initSocket, disconnectSocket } from '../services/socket';

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
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (data: { username?: string; first_name: string; middle_name: string; last_name: string; office?: string }) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
  }, []);

  useEffect(() => {
    if (user) {
      initSocket(user.user_id, user.roles || [user.role]);
    }
    return () => {
      disconnectSocket();
    };
  }, [user]);

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

  const login = async (username: string, password: string) => {
    const response = await api.post('/auth/login', { username, password });
    if (response.data.user) {
      setUser(response.data.user);
    }
  };

  const logout = async () => {
    await api.post('/auth/logout');
    setUser(null);
  };

  const updateUser = async (data: { username?: string; first_name: string; middle_name: string; last_name: string; office?: string }) => {
    await api.put('/auth/update_profile', data);
    const response = await api.get('/auth/me');
    setUser(response.data);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, updateUser }}>
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
