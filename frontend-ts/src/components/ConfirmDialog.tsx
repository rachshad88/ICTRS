import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Destructive actions get a red confirm button and edge. */
  danger?: boolean;
}

/**
 * A styled stand-in for window.confirm(). Render `dialog` somewhere in the page (inside .app-main,
 * so it picks up the app's modal styles) and await `confirm(...)`:
 *
 *   const [confirm, dialog] = useConfirm();
 *   if (!(await confirm({ title: 'Cancel this request?', danger: true }))) return;
 */
export function useConfirm() {
  const [ask, setAsk] = useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setAsk({ ...options, resolve })),
    [],
  );

  const answer = useCallback(
    (ok: boolean) => {
      ask?.resolve(ok);
      setAsk(null);
    },
    [ask],
  );

  const dialog = ask ? <ConfirmDialog {...ask} onAnswer={answer} /> : null;
  return [confirm, dialog] as const;
}

function ConfirmDialog({ title, message, confirmLabel = 'Confirm', cancelLabel = 'Go back', danger, onAnswer }: ConfirmOptions & { onAnswer: (ok: boolean) => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  // Focus starts on the safe choice; Escape backs out (useModalEscape in App.tsx presses data-modal-dismiss).
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  return (
    <div className="modal confirm-modal" onClick={(e) => e.target === e.currentTarget && onAnswer(false)}>
      <div className={`modal-content confirm-content${danger ? ' is-danger' : ''}`} role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby={message ? 'confirm-message' : undefined}>
        <h3 id="confirm-title">{title}</h3>
        {message && <p id="confirm-message" className="confirm-message">{message}</p>}
        <div className="modal-actions">
          <button data-modal-dismiss type="button" className="btn-secondary" ref={cancelRef} onClick={() => onAnswer(false)}>
            {cancelLabel}
          </button>
          <button type="button" className={danger ? 'btn-danger' : 'btn-primary'} onClick={() => onAnswer(true)}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
