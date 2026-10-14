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
          <motion.div
            key={notification.id}
            className={`toast-item ${notification.type}`}
            layout="position"
            initial={{ opacity: 0, x: 48, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 48, scale: 0.96, transition: { duration: 0.16, ease: EASE_OUT } }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          >
            <button type="button" className="toast-open" onClick={() => openToast(notification)}>
              <div className="toast-title">{notification.title}</div>
              <div className="toast-message">{notification.message}</div>
            </button>
            {/* Closes the toast at once instead of waiting for it to time out; the notification stays in the panel. */}
            <button
              type="button"
              className="toast-close"
              onClick={() => dismissToast(notification.id)}
              aria-label={`Dismiss: ${notification.title}`}
              title="Dismiss"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export default ToastNotifications;
