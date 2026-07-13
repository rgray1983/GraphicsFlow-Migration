import { useEffect } from 'react';

type ToastProps = {
  message: string | null;
  onDismiss: () => void;
  tone?: 'success' | 'info';
};

export function Toast({ message, onDismiss, tone = 'success' }: ToastProps) {
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(onDismiss, 3500);
    return () => window.clearTimeout(timer);
  }, [message, onDismiss]);

  if (!message) return null;

  return (
    <div className={`toast toast-${tone}`} role="status" aria-live="polite">
      <span className="toast-icon" aria-hidden="true">✓</span>
      <span className="toast-message">{message}</span>
      <button className="toast-close" type="button" onClick={onDismiss} aria-label="Dismiss notification">×</button>
    </div>
  );
}
