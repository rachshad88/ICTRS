import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { api } from '../services/api';
import { getSocket } from '../services/socket';
import { useAuth } from './AuthContext';

interface UnassignedCounts {
  total: number;
  multimedia: number;
  digitalMedia: number;
  printMaterials: number;
}

interface NotificationContextType {
  counts: UnassignedCounts;
}

const NotificationContext = createContext<NotificationContextType>({ counts: { total: 0, multimedia: 0, digitalMedia: 0, printMaterials: 0 } });

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [counts, setCounts] = useState<UnassignedCounts>({ total: 0, multimedia: 0, digitalMedia: 0, printMaterials: 0 });

  const fetchCounts = useCallback(async () => {
    if (!user) return;
    try {
      const res = await api.get('/notifications/unassigned-count');
      setCounts(res.data);
    } catch (err) {
      console.error('Failed to fetch notification counts:', err);
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    const socket = getSocket();
    if (!socket) return;

    const events = [
      'multimedia_request_created', 'multimedia_request_assigned', 'multimedia_request_assigned_admin',
      'multimedia_request_completed', 'multimedia_request_cancelled',
      'digital_media_request_created', 'digital_media_request_assigned', 'digital_media_request_assigned_admin',
      'digital_media_request_completed', 'digital_media_request_cancelled',
      'print_materials_request_created', 'print_materials_request_assigned', 'print_materials_request_assigned_admin',
      'print_materials_request_completed', 'print_materials_request_cancelled',
      'request_update',
    ];

    const handler = () => fetchCounts();
    for (const event of events) {
      socket.on(event, handler);
    }
    socket.on('connect', handler);

    fetchCounts();

    return () => {
      for (const event of events) {
        socket.off(event, handler);
      }
      socket.off('connect', handler);
    };
  }, [fetchCounts, user]);

  return (
    <NotificationContext.Provider value={{ counts }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotification() {
  return useContext(NotificationContext);
}
