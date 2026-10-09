import { useAuth } from '../contexts/AuthContext';

/** True while a self sign-up is waiting for an admin; the backend refuses its requests until then. */
export function useAwaitingApproval(): boolean {
  const { user } = useAuth();
  return user?.approved === false;
}

/** The note shown on the request forms and Profile until an admin approves the account. */
function AwaitingApproval() {
  if (!useAwaitingApproval()) return null;
  return (
    <div className="approval-notice" role="status">
      <strong>Your account is waiting for approval.</strong>
      <span>
        The IT office checks new accounts before they can submit requests. You'll get a notification
        here as soon as yours is approved, and you can use the system in the meantime.
      </span>
    </div>
  );
}

export default AwaitingApproval;
