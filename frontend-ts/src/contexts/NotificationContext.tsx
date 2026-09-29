import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { api } from '../services/api';
import { initSocket } from '../services/socket';
import { useAuth } from './AuthContext';

interface UnassignedCounts {
  total: number;
  multimedia: number;
  digitalMedia: number;
  printMaterials: number;
}

export interface LiveNotification {
  id: string;
  type: 'success' | 'info' | 'warning' | 'error';
  title: string;
  message: string;
}

interface NotificationContextType {
  counts: UnassignedCounts;
  notifications: LiveNotification[];
}

const NotificationContext = createContext<NotificationContextType>({
  counts: { total: 0, multimedia: 0, digitalMedia: 0, printMaterials: 0 },
  notifications: []
});

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [counts, setCounts] = useState<UnassignedCounts>({ total: 0, multimedia: 0, digitalMedia: 0, printMaterials: 0 });
  const [notifications, setNotifications] = useState<LiveNotification[]>([]);

  const fetchCounts = useCallback(async () => {
    if (!user) return;
    try {
      const res = await api.get('/notifications/unassigned-count');
      setCounts(res.data);
    } catch (err) {
      console.error('Failed to fetch notification counts:', err);
    }
  }, [user]);

  const pushNotification = useCallback((notification: Omit<LiveNotification, 'id'>) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    setNotifications((prev) => [...prev, { id, ...notification }]);

    window.setTimeout(() => {
      setNotifications((current) => current.filter((item) => item.id !== id));
    }, 5500);
  }, []);

  const userId = user?.user_id;

  const formatEventNotification = useCallback((event: string, payload: any): Omit<LiveNotification, 'id'> | null => {
    const requestLabel = typeof payload?.request_code === 'string' ? payload.request_code : 'A request';

    if (event === 'request_update') {
      const status = payload?.event;
      if (status === 'created') {
        // The client who just submitted it already sees a confirmation on the form.
        if (payload?.created_by === userId) return null;
        return { title: 'New request', message: `${requestLabel} has been created.`, type: 'info' };
      }
      // The owner and the technician each get their own targeted event for these.
      if (status === 'accepted' || status === 'finished') {
        return null;
      }
      if (status === 'cancelled') {
        return { title: 'Request cancelled', message: `${requestLabel} was cancelled.`, type: 'warning' };
      }
      if (status === 'declined') {
        return { title: 'Request declined', message: `${requestLabel} was declined.`, type: 'warning' };
      }
      // These broadcasts only refresh lists; the people affected get their own targeted toast.
      if (status === 'note_added' || status === 'reassigned' || status === 'priority_changed') {
        return null;
      }
      return { title: 'Request updated', message: `${requestLabel} has new details.`, type: 'info' };
    }

    if (event === 'request_assigned_to_you') {
      return { title: 'Assigned to you', message: `${requestLabel} was assigned to you.`, type: 'success' };
    }

    if (event === 'request_reassigned_from_you' || event.endsWith('_request_reassigned')) {
      return { title: 'Request reassigned', message: `${requestLabel} is now handled by a different staff member.`, type: 'info' };
    }

    if (event.endsWith('_request_priority_changed')) {
      const level = typeof payload?.priority === 'string' ? payload.priority.toLowerCase() : 'updated';
      return { title: 'Priority changed', message: `${requestLabel} is now ${level} priority.`, type: payload?.priority === 'URGENT' ? 'warning' : 'info' };
    }

    if (event === 'my_request_accepted') {
      return { title: 'Request approved', message: `${requestLabel} has been accepted.`, type: 'success' };
    }

    if (event === 'my_request_finished') {
      return { title: 'Request completed', message: `${requestLabel} is complete.`, type: 'success' };
    }

    if (event === 'my_request_declined' || event.endsWith('_request_declined')) {
      const reason = typeof payload?.reason === 'string' ? ` Reason: ${payload.reason}` : '';
      return { title: 'Request declined', message: `${requestLabel} was declined.${reason}`, type: 'warning' };
    }

    if (event === 'request_note_added' || event.endsWith('_request_note_added')) {
      return { title: 'New note', message: `The client added a note to ${requestLabel}.`, type: 'info' };
    }

    if (event.includes('_created')) {
      return { title: 'New request', message: `${requestLabel} was created.`, type: 'info' };
    }
    if (event.includes('_assigned')) {
      return { title: 'Request assigned', message: `${requestLabel} has been assigned.`, type: 'success' };
    }
    if (event.includes('_completed')) {
      return { title: 'Request completed', message: `${requestLabel} is complete.`, type: 'success' };
    }
    if (event.includes('_cancelled')) {
      return { title: 'Request cancelled', message: `${requestLabel} was cancelled.`, type: 'warning' };
    }

    return null;
  }, [userId]);

  useEffect(() => {
    if (!user) return;

    fetchCounts();

    // This provider's effect runs before AuthProvider's, so create the socket here if it doesn't exist yet
    // (initSocket returns the existing one otherwise).
    const socket = initSocket();

    const events = [
      'multimedia_request_created', 'multimedia_request_assigned', 'multimedia_request_assigned_admin',
      'multimedia_request_completed', 'multimedia_request_cancelled',
      'multimedia_request_declined', 'multimedia_request_note_added',
      'multimedia_request_reassigned', 'multimedia_request_priority_changed',
      'digital_media_request_created', 'digital_media_request_assigned', 'digital_media_request_assigned_admin',
      'digital_media_request_completed', 'digital_media_request_cancelled',
      'digital_media_request_declined', 'digital_media_request_note_added',
      'digital_media_request_reassigned', 'digital_media_request_priority_changed',
      'print_materials_request_created', 'print_materials_request_assigned', 'print_materials_request_assigned_admin',
      'print_materials_request_completed', 'print_materials_request_cancelled',
      'print_materials_request_declined', 'print_materials_request_note_added',
      'print_materials_request_reassigned', 'print_materials_request_priority_changed',
      'request_update',
      'request_assigned_to_you',
      'request_reassigned_from_you',
      'my_request_accepted',
      'my_request_finished',
      'my_request_declined',
      'request_note_added'
    ];

    const handlers: Record<string, (data: any) => void> = {};

    for (const event of events) {
      const handler = (data: any) => {
        fetchCounts();
        const notification = formatEventNotification(event, data);
        if (notification) pushNotification(notification);
      };
      handlers[event] = handler;
      socket.on(event, handler);
    }

    socket.on('connect', fetchCounts);

    return () => {
      for (const event of events) {
        socket.off(event, handlers[event]);
      }
      socket.off('connect', fetchCounts);
    };
  }, [fetchCounts, formatEventNotification, pushNotification, user]);

  return (
    <NotificationContext.Provider value={{ counts, notifications }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotification() {
  return useContext(NotificationContext);
}
