import { AnimatePresence, motion } from 'framer-motion';
import { useNotification } from '../contexts/NotificationContext';

function ToastNotifications() {
  const { notifications } = useNotification();

  return (
    <div className="toast-list">
      <AnimatePresence initial={false}>
        {notifications.map((notification) => (
          <motion.div
            key={notification.id}
            className={`toast-item ${notification.type}`}
            initial={{ opacity: 0, x: 48, scale: 0.96 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: 48, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
          >
            <div className="toast-title">{notification.title}</div>
            <div className="toast-message">{notification.message}</div>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}

export default ToastNotifications;
