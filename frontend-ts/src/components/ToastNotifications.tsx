import { AnimatePresence, motion } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { useNotification, type LiveNotification } from '../contexts/NotificationContext';
import { EASE_OUT } from '../lib/motion';

function ToastNotifications() {
  const { notifications, dismissToast, markRead } = useNotification();
  const navigate = useNavigate();

  // A toast for a saved notification opens it, the same as clicking it in the panel.
  const openToast = (toast: LiveNotification) => {
    dismissToast(toast.id);
    if (!toast.source) return;
    markRead(toast.source.id);
    if (toast.source.link) navigate(toast.source.link);
  };

  return (
    <div className="toast-list">
      <AnimatePresence initial={false}>
        {notifications.map((notification) => (
          <motion.button
            type="button"
            key={notification.id}
            onClick={() => openToast(notification)}
            className={`toast-item ${notification.type}`}
            layout="position"
            initial={{ opacity: 0, x: 48, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 48, scale: 0.96, transition: { duration: 0.16, ease: EASE_OUT } }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          >
            <div className="toast-title">{notification.title}</div>
            <div className="toast-message">{notification.message}</div>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}

export default ToastNotifications;
