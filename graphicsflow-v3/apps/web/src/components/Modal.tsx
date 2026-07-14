import { useEffect, useId, type ReactNode } from 'react';

type ModalProps = {
  children: ReactNode;
  isOpen: boolean;
  onClose: () => void;
  title: string;
  variant?: 'default' | 'viewer' | 'creator';
};

export function Modal({ children, isOpen, onClose, title, variant = 'default' }: ModalProps) {
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [isOpen]);

  if (!isOpen) return null;
  const variantClass = variant === 'viewer' ? ' modal-dialog-viewer' : variant === 'creator' ? ' modal-dialog-creator' : '';

  return (
    <div className="modal-layer" role="presentation">
      <button aria-label="Close modal" className="modal-backdrop" onClick={onClose} type="button" />
      <section aria-labelledby={titleId} aria-modal="true" className={`modal-dialog${variantClass}`} role="dialog">
        <header className="modal-header">
          <h2 id={titleId}>{title}</h2>
          <button aria-label="Close" className="icon-button" onClick={onClose} type="button">×</button>
        </header>
        <div className="modal-body">{children}</div>
      </section>
    </div>
  );
}
