import { useEffect, useId, type ReactNode } from 'react';

type ModalProps = {
  children: ReactNode;
  isOpen: boolean;
  onClose: () => void;
  title: string;
};

export function Modal({ children, isOpen, onClose, title }: ModalProps) {
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="modal-layer" role="presentation">
      <button aria-label="Close modal" className="modal-backdrop" onClick={onClose} type="button" />
      <section aria-labelledby={titleId} aria-modal="true" className="modal-dialog" role="dialog">
        <header className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button aria-label="Close" className="icon-button" onClick={onClose} type="button">×</button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}
