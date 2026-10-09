import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { api } from '../services/api';
import { initSocket } from '../services/socket';
import { playNotification } from '../services/sfx';
import { useAuth } from './AuthContext';

interface UnassignedCounts {
  total: number;
  multimedia: number;
  digitalMedia: number;
  printMaterials: number;
}

type Level = 'success' | 'info' | 'warning' | 'error';

// A short-lived toast.
export interface LiveNotification {
  id: string;
  type: Level;
  title: string;
  message: string;
  // The saved notification it came from, so clicking the toast can open and mark it.
  source?: InboxNotification;
}

// A saved notification from the server, shown in the bell panel.
export interface InboxNotification {
  id: string;
  level: Level;
  title: string;
  message: string;
  link: string | null;
  request_code: string | null;
  // Present on "request completed" notifications: enough to open the rating form directly.
  rate?: { request_id: string; type: string } | null;
  read: boolean;
  created_at: string;
}

interface NotificationContextType {
  counts: UnassignedCounts;
  notifications: LiveNotification[];
  dismissToast: (id: string) => void;
  inbox: InboxNotification[];
  unread: number;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clearOne: (id: string) => void;
  clearAll: () => void;
}

const NotificationContext = createContext<NotificationContextType>({
  counts: { total: 0, multimedia: 0, digitalMedia: 0, printMaterials: 0 },
  notifications: [],
  dismissToast: () => {},
  inbox: [],
  unread: 0,
  markRead: () => {},
  markAllRead: () => {},
  clearOne: () => {},
  clearAll: () => {},
});

export function NotificationProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [counts, setCounts] = useState<UnassignedCounts>({ total: 0, multimedia: 0, digitalMedia: 0, printMaterials: 0 });
  const [notifications, setNotifications] = useState<LiveNotification[]>([]);
  const [inbox, setInbox] = useState<InboxNotification[]>([]);
  const [unread, setUnread] = useState(0);

  const fetchCounts = useCallback(async () => {
    if (!user) return;
    try {
      const res = await api.get('/notifications/unassigned-count');
      setCounts(res.data);
    } catch (err) {
      console.error('Failed to fetch notification counts:', err);
    }
  }, [user]);

  const fetchInbox = useCallback(async () => {
    if (!user) return;
    try {
      const res = await api.get('/notifications');
      setInbox(res.data.items);
      setUnread(res.data.unread);
    } catch (err) {
      console.error('Failed to fetch notifications:', err);
    }
  }, [user]);

  const markRead = useCallback((id: string) => {
    const target = inbox.find((n) => n.id === id);
    if (!target || target.read) return;
    setInbox((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    setUnread((u) => Math.max(0, u - 1));
    api.post(`/notifications/${id}/read`).catch((err) => console.error('Failed to mark notification read:', err));
  }, [inbox]);

  const markAllRead = useCallback(() => {
    setInbox((prev) => prev.map((n) => (n.read ? n : { ...n, read: true })));
    setUnread(0);
    api.post('/notifications/read_all').catch((err) => console.error('Failed to mark notifications read:', err));
  }, []);

  const clearOne = useCallback((id: string) => {
    const target = inbox.find((n) => n.id === id);
    if (!target) return;
    setInbox((prev) => prev.filter((n) => n.id !== id));
    if (!target.read) setUnread((u) => Math.max(0, u - 1));
    api.post(`/notifications/${id}/clear`).catch((err) => console.error('Failed to clear notification:', err));
  }, [inbox]);

  const clearAll = useCallback(() => {
    setInbox([]);
    setUnread(0);
    api.post('/notifications/clear_all').catch((err) => console.error('Failed to clear notifications:', err));
  }, []);

  const dismissToast = useCallback((id: string) => {
    setNotifications((current) => current.filter((item) => item.id !== id));
  }, []);

  const pushNotification = useCallback((notification: Omit<LiveNotification, 'id'>) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    setNotifications((prev) => [...prev, { id, ...notification }]);

    window.setTimeout(() => {
      setNotifications((current) => current.filter((item) => item.id !== id));
    }, 5500);
  }, []);


  useEffect(() => {
    if (!user) return;

    fetchCounts();
    fetchInbox();

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

    // These only keep the sidebar counts fresh; what the user is told arrives as 'notification:new'.
    for (const event of events) {
      socket.on(event, fetchCounts);
    }

    const onNotification = (n: InboxNotification) => {
      setInbox((prev) => (prev.some((p) => p.id === n.id) ? prev : [n, ...prev].slice(0, 50)));
      setUnread((u) => u + 1);
      playNotification(n.title, n.level);
      pushNotification({ title: n.title, message: n.message, type: n.level, source: n });
    };
    socket.on('notification:new', onNotification);

    // Catch up on anything sent while the connection was down.
    const onConnect = () => {
      fetchCounts();
      fetchInbox();
    };
    socket.on('connect', onConnect);

    return () => {
      for (const event of events) {
        socket.off(event, fetchCounts);
      }
      socket.off('notification:new', onNotification);
      socket.off('connect', onConnect);
    };
  }, [fetchCounts, fetchInbox, pushNotification, user]);

  // Nothing from the previous account should linger after logout or a switch.
  useEffect(() => {
    if (!user) {
      setInbox([]);
      setUnread(0);
      setNotifications([]);
    }
  }, [user]);

  return (
    <NotificationContext.Provider value={{ counts, notifications, dismissToast, inbox, unread, markRead, markAllRead, clearOne, clearAll }}>
      {children}
    </NotificationContext.Provider>
  );
}

export function useNotification() {
  return useContext(NotificationContext);
}
